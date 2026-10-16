import { z } from "zod";
import { consultarRegistrosIxc, IxcConnectionError, type IxcTransportInput } from "./client";

const id = z
  .union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().regex(/^\d{1,20}$/));
const texto = z.string().nullish();
type Transportar = (input: IxcTransportInput) => Promise<string>;

export async function resolverDestinoOrdemIxc(
  baseUrl: string,
  token: string,
  assunto: string,
  setor: string,
  transportar?: Transportar,
) {
  if (!assunto.trim() || !setor.trim())
    throw new Error("Configure assunto e setor das O.S. na integração IXC.");
  const [assuntos, setores] = await Promise.all([
    consultarRegistrosIxc(baseUrl, token, "su_oss_assunto", "assunto", assunto.trim(), transportar),
    consultarRegistrosIxc(baseUrl, token, "empresa_setor", "setor", setor.trim(), transportar),
  ]);
  const a = z.array(z.object({ id, assunto: z.string() })).safeParse(assuntos);
  const s = z.array(z.object({ id, setor: z.string() })).safeParse(setores);
  const normalizar = (v: string) => v.trim().normalize("NFC").toLocaleLowerCase("pt-BR");
  const assuntoEncontrado = a.success ? a.data[0] : undefined;
  const setorEncontrado = s.success ? s.data[0] : undefined;
  if (
    !a.success ||
    !s.success ||
    a.data.length !== 1 ||
    s.data.length !== 1 ||
    !assuntoEncontrado ||
    !setorEncontrado ||
    normalizar(assuntoEncontrado.assunto) !== normalizar(assunto) ||
    normalizar(setorEncontrado.setor) !== normalizar(setor)
  ) {
    throw new Error(
      "Assunto ou setor não encontrado de forma única no IXC. Confira a configuração antes de abrir a O.S.",
    );
  }
  return { assuntoId: assuntoEncontrado.id, setorId: setorEncontrado.id };
}

// Projeções fechadas: o IXC também devolve senhas de PPPoE/ONU nestas tabelas.
const loginSchema = z.object({
  id,
  id_cliente: id,
  id_contrato: id,
  online: texto,
  ultima_conexao_inicial: texto,
  ultima_conexao_final: texto,
  motivo_desconexao: texto,
  ultima_atualizacao: texto,
});
const fibraSchema = z.object({
  id,
  id_contrato: id,
  sinal_rx: texto,
  sinal_tx: texto,
  data_sinal: texto,
  causa_ultima_queda: texto,
});
const ordemSchema = z.object({
  id,
  id_cliente: id,
  id_contrato_kit: id,
  status: z.string(),
  protocolo: texto,
  id_assunto: id,
  setor: id,
  data_abertura: texto,
  data_agenda: texto,
  data_agenda_final: texto,
  data_fechamento: texto,
});
const tituloSchema = z.object({
  id,
  id_cliente: id,
  id_contrato: id.nullish(),
  id_contrato_avulso: id.nullish(),
  status: z.string(),
  valor_aberto: texto,
  pagamento_data: texto,
  aguardando_confirmacao_pagamento: texto,
});

/** Consulta pontual: não depende do tamanho do histórico do contrato. */
export async function consultarOrdemIxc(
  baseUrl: string,
  token: string,
  clienteId: string,
  contratoId: string,
  ordemId: string,
  transportar?: Transportar,
) {
  [clienteId, contratoId, ordemId].forEach((v) => id.parse(v));
  const raw = await consultarRegistrosIxc(
    baseUrl,
    token,
    "su_oss_chamado",
    "id",
    ordemId,
    transportar,
  );
  if (raw.length !== 1) inconsistente();
  const r = ordemSchema.safeParse(raw[0]);
  if (
    !r.success ||
    r.data.id !== ordemId ||
    r.data.id_cliente !== clienteId ||
    r.data.id_contrato_kit !== contratoId
  )
    inconsistente();
  return { ...r.data, finalizada: r.data.status === "F" };
}

function inconsistente(): never {
  throw new IxcConnectionError(
    "unexpected_response",
    "O IXC retornou dados incompatíveis com o cliente e contrato escolhidos.",
  );
}

/** Fonte: wikiapiprovedor.ixcsoft.com.br/formulario.php?form=radusuarios (e fibra). */
export async function consultarDiagnosticoIxc(
  baseUrl: string,
  token: string,
  clienteId: string,
  contratoId: string,
  transportar?: Transportar,
) {
  id.parse(clienteId);
  id.parse(contratoId);
  const loginsRaw = await consultarRegistrosIxc(
    baseUrl,
    token,
    "radusuarios",
    "id_contrato",
    contratoId,
    transportar,
  );
  const logins = loginsRaw.map((raw) => {
    const r = loginSchema.safeParse(raw);
    if (!r.success || r.data.id_cliente !== clienteId || r.data.id_contrato !== contratoId)
      inconsistente();
    return {
      ...r.data,
      conexao:
        r.data.online === "S" ? "online" : r.data.online === "N" ? "offline" : "desconhecida",
    };
  });
  // A consulta RADIUS continua útil mesmo que o usuário não tenha permissão para ONU.
  let sinalDisponivel = true;
  let fibras: z.infer<typeof fibraSchema>[] = [];
  try {
    const raw = await consultarRegistrosIxc(
      baseUrl,
      token,
      "radpop_radio_cliente_fibra",
      "id_contrato",
      contratoId,
      transportar,
    );
    fibras = raw.map((registro) => {
      const r = fibraSchema.safeParse(registro);
      if (!r.success || r.data.id_contrato !== contratoId) inconsistente();
      return r.data;
    });
  } catch {
    sinalDisponivel = false;
  }
  return {
    consultado_em: new Date().toISOString(),
    logins,
    fibras,
    sinal_disponivel: sinalDisponivel && fibras.length > 0,
    incidente_regional: "nao_consultado",
    aviso:
      "São as últimas medições registradas no IXC, não uma leitura ao vivo da ONU. Considere as datas; sem medição, declare desconhecido. Online não prova qualidade nem resolve a queixa. Não afirme falha regional sem uma fonte de incidentes conectada.",
  };
}

/** Consulta status e agenda existentes; nunca inventa janela de visita. */
export async function listarOrdensIxc(
  baseUrl: string,
  token: string,
  clienteId: string,
  contratoId: string,
  transportar?: Transportar,
) {
  id.parse(clienteId);
  id.parse(contratoId);
  const raw = await consultarRegistrosIxc(
    baseUrl,
    token,
    "su_oss_chamado",
    "id_contrato_kit",
    contratoId,
    transportar,
  );
  return raw.map((registro) => {
    const r = ordemSchema.safeParse(registro);
    if (!r.success || r.data.id_cliente !== clienteId || r.data.id_contrato_kit !== contratoId)
      inconsistente();
    return { ...r.data, finalizada: r.data.status === "F" };
  });
}

/** Confirma a baixa de UM título selecionado; ausência não significa pagamento. */
export async function consultarPagamentoIxc(
  baseUrl: string,
  token: string,
  clienteId: string,
  contratoId: string,
  tituloId: string,
  transportar?: Transportar,
) {
  id.parse(clienteId);
  id.parse(contratoId);
  id.parse(tituloId);
  const raw = await consultarRegistrosIxc(
    baseUrl,
    token,
    "fn_areceber",
    "id",
    tituloId,
    transportar,
  );
  if (raw.length === 0) return { encontrado: false, pagamento_confirmado: false };
  if (raw.length !== 1) inconsistente();
  const r = tituloSchema.safeParse(raw[0]);
  if (!r.success || r.data.id !== tituloId || r.data.id_cliente !== clienteId) inconsistente();
  const contratos = [r.data.id_contrato, r.data.id_contrato_avulso].filter((v) => v && v !== "0");
  if (!contratos.includes(contratoId) || contratos.some((v) => v !== contratoId)) inconsistente();
  const saldoZerado =
    r.data.valor_aberto != null && /^0+(?:[.,]0+)?$/.test(r.data.valor_aberto.trim());
  return {
    encontrado: true,
    ...r.data,
    pagamento_confirmado:
      r.data.status === "R" && saldoZerado && r.data.aguardando_confirmacao_pagamento === "N",
    consultado_em: new Date().toISOString(),
    aviso:
      "Comprovante do cliente não é confirmação de baixa. Não dê baixa manual nem desbloqueie sem a ação autorizada. Título recebido não prova quitação de outros títulos do contrato.",
  };
}
