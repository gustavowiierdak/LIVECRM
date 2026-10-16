/**
 * A consulta interna da Inbox lê o atendimento selecionado, não o acervo geral.
 * O conteúdo do cliente é registro de terceiros: fica cercado como dado e nunca
 * vira instrução do modelo. O limite impede um histórico longo de estourar o
 * orçamento de uma pergunta curta.
 */
import { ABRE_DADOS, FECHA_DADOS } from "./conversa-do-caso/contexto";

export interface MensagemDoAtendimento {
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  media_derived_text: string | null;
  sent_via: string | null;
  sent_at: string;
}

const MARCADOR_DE_ANEXO =
  /^(imagem|foto|áudio|audio|documento|arquivo|vídeo|video) (enviad[oa]|recebid[oa])\.?$/i;

export function temRelatoDoCliente(mensagens: readonly MensagemDoAtendimento[]): boolean {
  return mensagens.some(
    (m) =>
      m.direction === "inbound" &&
      (Boolean(m.media_derived_text?.trim()) ||
        (Boolean(m.body?.trim()) && !MARCADOR_DE_ANEXO.test(m.body!.trim()))),
  );
}

export function montarDadosDoAtendimento(mensagens: readonly MensagemDoAtendimento[]): string {
  const linhas = mensagens.slice(-24).map((m) => {
    const quem = m.direction === "inbound" ? "cliente" : m.sent_via === "ai" ? "IA" : "equipe";
    const corpo = m.body?.trim().slice(0, 600) || `[${m.type} sem texto]`;
    const derivado = m.media_derived_text?.trim().slice(0, 600);
    const detalhe = derivado ? ` · conteúdo extraído do anexo: ${derivado}` : "";
    return `[${quem}] ${m.sent_at}: ${corpo}${detalhe}`;
  });
  return [
    ABRE_DADOS,
    "Histórico do atendimento atual (do mais antigo ao mais recente):",
    ...linhas,
    FECHA_DADOS,
  ].join("\n");
}
