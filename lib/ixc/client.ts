import { lookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import * as https from "node:https";
import type { LookupAddress, LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";

import ipaddr from "ipaddr.js";
import { z } from "zod";

const IXC_TIMEOUT_MS = 10_000;
const IXC_RESPONSE_LIMIT = 256 * 1024;

export type IxcErrorCode =
  | "invalid_url"
  | "unsafe_destination"
  | "timeout"
  | "connection_failed"
  | "unauthorized"
  | "unexpected_response";

export class IxcConnectionError extends Error {
  constructor(
    public readonly code: IxcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IxcConnectionError";
  }
}

function hostnameSemColchetes(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function enderecoPublico(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

/** Aceita a forma amigável com barra final, mas persiste somente a origem exata. */
export function normalizarBaseIxc(valor: string): string {
  let url: URL;
  try {
    url = new URL(valor.trim());
  } catch {
    throw new IxcConnectionError("invalid_url", "Informe uma URL HTTPS válida.");
  }

  const hostname = hostnameSemColchetes(url.hostname).toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== "" ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost")
  ) {
    throw new IxcConnectionError(
      "invalid_url",
      "Use somente a origem HTTPS do IXC, sem caminho, usuário, parâmetros ou #.",
    );
  }
  if (ipaddr.isValid(hostname) && !enderecoPublico(hostname)) {
    throw new IxcConnectionError("unsafe_destination", "O endereço precisa ser público.");
  }
  return url.origin;
}

async function resolverEnderecosPublicos(hostname: string, signal: AbortSignal) {
  const literal = hostnameSemColchetes(hostname);
  const enderecos: LookupAddress[] = ipaddr.isValid(literal)
    ? [{ address: literal, family: ipaddr.process(literal).kind() === "ipv4" ? 4 : 6 }]
    : await Promise.race([
        lookup(literal, { all: true, verbatim: true }),
        new Promise<never>((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        ),
      ]);

  if (enderecos.length === 0 || enderecos.some(({ address }) => !enderecoPublico(address))) {
    throw new IxcConnectionError(
      "unsafe_destination",
      "O domínio do IXC aponta para uma rede privada ou reservada.",
    );
  }
  return enderecos;
}

function lookupFixado(hostnameEsperado: string, enderecos: LookupAddress[]): LookupFunction {
  return (hostname, options: LookupOptions, callback) => {
    if (hostname !== hostnameEsperado) {
      callback(Object.assign(new Error("Hostname inesperado."), { code: "EHOSTUNREACH" }), "", 0);
      return;
    }
    if (options.all) {
      callback(null, enderecos);
      return;
    }
    const primeiro = enderecos[0];
    if (!primeiro) {
      callback(
        Object.assign(new Error("Sem endereço resolvido."), { code: "EHOSTUNREACH" }),
        "",
        0,
      );
      return;
    }
    callback(null, primeiro.address, primeiro.family);
  };
}

async function lerResposta(response: IncomingMessage): Promise<string> {
  const tamanho = Number(response.headers["content-length"] ?? "0");
  if (Number.isFinite(tamanho) && tamanho > IXC_RESPONSE_LIMIT) {
    response.destroy();
    throw new IxcConnectionError("unexpected_response", "A resposta do IXC excedeu o limite.");
  }
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of response) {
    const bytes = Buffer.isBuffer(parte) ? parte : Buffer.from(parte);
    total += bytes.length;
    if (total > IXC_RESPONSE_LIMIT) {
      response.destroy();
      throw new IxcConnectionError("unexpected_response", "A resposta do IXC excedeu o limite.");
    }
    partes.push(bytes);
  }
  return Buffer.concat(partes).toString("utf8");
}

async function postar(url: URL, token: string, body: string, signal: AbortSignal): Promise<string> {
  const hostname = hostnameSemColchetes(url.hostname);
  const enderecos = await resolverEnderecosPublicos(hostname, signal);

  return new Promise<string>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        agent: false,
        signal,
        lookup: lookupFixado(hostname, enderecos),
        servername: ipaddr.isValid(hostname) ? undefined : hostname,
        headers: {
          accept: "application/json",
          "accept-encoding": "identity",
          authorization: `Basic ${Buffer.from(token, "utf8").toString("base64")}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          ixcsoft: "listar",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.destroy();
          reject(
            new IxcConnectionError(
              "unexpected_response",
              "O IXC tentou redirecionar a requisição.",
            ),
          );
          return;
        }
        if (status === 401 || status === 403) {
          response.destroy();
          reject(
            new IxcConnectionError("unauthorized", "O IXC recusou o token ou suas permissões."),
          );
          return;
        }
        if (status < 200 || status >= 300) {
          response.destroy();
          reject(new IxcConnectionError("connection_failed", `O IXC respondeu HTTP ${status}.`));
          return;
        }
        lerResposta(response).then(resolve, reject);
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

export interface IxcTransportInput {
  url: URL;
  token: string;
  body: string;
  signal: AbortSignal;
}

const identificadorIxc = z
  .union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().regex(/^\d{1,20}$/));
const clienteIxcSchema = z
  .object({
    id: identificadorIxc,
    cnpj_cpf: z.string(),
    razao: z.string().nullish(),
    fantasia: z.string().nullish(),
    ativo: z.string().nullish(),
    telefone_celular: z.string().nullish(),
    whatsapp: z.string().nullish(),
  })
  .passthrough();
const contratoIxcSchema = z
  .object({
    id: identificadorIxc,
    id_cliente: identificadorIxc,
    contrato: z.string().nullish(),
    status: z.string().nullish(),
    status_internet: z.string().nullish(),
    bloqueio_automatico: z.string().nullish(),
    contrato_suspenso: z.string().nullish(),
  })
  .passthrough();

export type IxcCustomer = Pick<
  z.infer<typeof clienteIxcSchema>,
  "id" | "razao" | "fantasia" | "ativo" | "telefone_celular" | "whatsapp"
>;
export type IxcContract = z.infer<typeof contratoIxcSchema>;

function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

async function consultarRegistrosIxc(
  baseUrl: string,
  token: string,
  entidade: "cliente" | "cliente_contrato",
  campo: "cnpj_cpf" | "id_cliente",
  query: string,
  transportar: (input: IxcTransportInput) => Promise<string>,
): Promise<unknown[]> {
  const origem = normalizarBaseIxc(baseUrl);
  const url = new URL(`/webservice/v1/${entidade}`, origem);
  const body = JSON.stringify({
    qtype: `${entidade}.${campo}`,
    query,
    oper: "=",
    page: "1",
    rp: "100",
    sortname: `${entidade}.id`,
    sortorder: "asc",
  });
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(new IxcConnectionError("timeout", "O IXC não respondeu em 10 segundos.")),
    IXC_TIMEOUT_MS,
  );
  try {
    const raw = await transportar({ url, token, body, signal: controller.signal });
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new IxcConnectionError("unexpected_response", "O IXC não retornou JSON válido.");
    }
    const resposta = z
      .object({
        registros: z.array(z.unknown()).max(100),
        total: z.union([z.string(), z.number()]).optional(),
        type: z.string().optional(),
      })
      .safeParse(json);
    if (!resposta.success || resposta.data.type === "error") {
      throw new IxcConnectionError("unexpected_response", "O IXC retornou um formato inesperado.");
    }
    const total = Number(resposta.data.total ?? resposta.data.registros.length);
    if (Number.isFinite(total) && total > resposta.data.registros.length) {
      throw new IxcConnectionError(
        "unexpected_response",
        "A consulta do IXC excedeu o limite seguro de registros.",
      );
    }
    return resposta.data.registros;
  } catch (error) {
    if (error instanceof IxcConnectionError) throw error;
    if (controller.signal.aborted)
      throw new IxcConnectionError("timeout", "O IXC não respondeu em 10 segundos.");
    throw new IxcConnectionError("connection_failed", "Não foi possível consultar o IXC.");
  } finally {
    clearTimeout(timeout);
  }
}

/** A resposta do IXC só é aceita quando o CPF devolvido coincide com o confirmado. */
export async function buscarClienteIxc(
  baseUrl: string,
  token: string,
  cpf: string,
  transportar: (input: IxcTransportInput) => Promise<string> = ({ url, token, body, signal }) =>
    postar(url, token, body, signal),
): Promise<IxcCustomer | null> {
  const documento = somenteDigitos(cpf);
  if (documento.length !== 11)
    throw new IxcConnectionError("unexpected_response", "Informe um CPF confirmado.");
  const consultas = [
    documento,
    `${documento.slice(0, 3)}.${documento.slice(3, 6)}.${documento.slice(6, 9)}-${documento.slice(9)}`,
  ];
  for (const query of consultas) {
    const registros = await consultarRegistrosIxc(
      baseUrl,
      token,
      "cliente",
      "cnpj_cpf",
      query,
      transportar,
    );
    for (const registro of registros) {
      const parsed = clienteIxcSchema.safeParse(registro);
      if (!parsed.success)
        throw new IxcConnectionError("unexpected_response", "O IXC retornou um cliente inválido.");
      if (somenteDigitos(parsed.data.cnpj_cpf) === documento) {
        return {
          id: parsed.data.id,
          razao: parsed.data.razao,
          fantasia: parsed.data.fantasia,
          ativo: parsed.data.ativo,
          telefone_celular: parsed.data.telefone_celular,
          whatsapp: parsed.data.whatsapp,
        };
      }
    }
  }
  return null;
}

export async function listarContratosIxc(
  baseUrl: string,
  token: string,
  clienteId: string,
  transportar: (input: IxcTransportInput) => Promise<string> = ({ url, token, body, signal }) =>
    postar(url, token, body, signal),
): Promise<IxcContract[]> {
  const id = identificadorIxc.safeParse(clienteId);
  if (!id.success)
    throw new IxcConnectionError("unexpected_response", "Identificação do cliente inválida.");
  const registros = await consultarRegistrosIxc(
    baseUrl,
    token,
    "cliente_contrato",
    "id_cliente",
    id.data,
    transportar,
  );
  return registros.map((registro) => {
    const parsed = contratoIxcSchema.safeParse(registro);
    if (!parsed.success || parsed.data.id_cliente !== id.data) {
      throw new IxcConnectionError("unexpected_response", "O IXC retornou um contrato inválido.");
    }
    return parsed.data;
  });
}

export async function testarConexaoIxc(
  baseUrl: string,
  token: string,
  transportar: (input: IxcTransportInput) => Promise<string> = ({ url, token, body, signal }) =>
    postar(url, token, body, signal),
): Promise<{ total: number | null }> {
  const origem = normalizarBaseIxc(baseUrl);
  const url = new URL("/webservice/v1/cliente", origem);
  const body = JSON.stringify({
    qtype: "cliente.id",
    query: "0",
    oper: ">",
    page: "1",
    rp: "1",
    sortname: "cliente.id",
    sortorder: "asc",
  });
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(new IxcConnectionError("timeout", "O IXC não respondeu em 10 segundos.")),
    IXC_TIMEOUT_MS,
  );

  try {
    const raw = await transportar({ url, token, body, signal: controller.signal });
    let resposta: { registros?: unknown; total?: unknown; type?: unknown };
    try {
      resposta = JSON.parse(raw) as typeof resposta;
    } catch {
      throw new IxcConnectionError(
        "unexpected_response",
        "O endereço respondeu, mas não retornou JSON da API do IXC.",
      );
    }
    if (!Array.isArray(resposta.registros) || resposta.type === "error") {
      throw new IxcConnectionError(
        "unexpected_response",
        "O endereço respondeu, mas não retornou o formato esperado da API do IXC.",
      );
    }
    const total = Number(resposta.total);
    return { total: Number.isFinite(total) ? total : null };
  } catch (error) {
    if (error instanceof IxcConnectionError) throw error;
    if (controller.signal.aborted) {
      throw new IxcConnectionError("timeout", "O IXC não respondeu em 10 segundos.");
    }
    throw new IxcConnectionError("connection_failed", "Não foi possível alcançar o IXC.");
  } finally {
    clearTimeout(timeout);
  }
}
