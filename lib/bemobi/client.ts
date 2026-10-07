import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import type { IncomingMessage } from "node:http";
import * as https from "node:https";
import type { LookupFunction } from "node:net";

import ipaddr from "ipaddr.js";
import { z } from "zod";

export const BEMOBI_BASE_URL = "https://api.7az.com.br";
const BEMOBI_HOST = "api.7az.com.br";
const BEMOBI_TIMEOUT_MS = 10_000;
const BEMOBI_RESPONSE_LIMIT = 1024 * 1024;

export type BemobiErrorCode =
  | "invalid_document"
  | "invalid_invoice"
  | "timeout"
  | "connection_failed"
  | "unauthorized"
  | "not_found"
  | "unexpected_response";

export class BemobiConnectionError extends Error {
  constructor(public readonly code: BemobiErrorCode, message: string) {
    super(message);
    this.name = "BemobiConnectionError";
  }
}

const faturaSchema = z
  .object({
    erpInvoiceId: z.union([z.string(), z.number()]).transform(String),
    uniqueId: z.string().min(1),
    dueDate: z.string().nullable().optional(),
    formatedDueDate: z.string().nullable().optional(),
    amount: z.number(),
    formatedAmount: z.string().nullable().optional(),
    competence: z.string().nullable().optional(),
    reference: z.union([z.string(), z.number()]).transform(String).nullable().optional(),
    status: z.union([z.string(), z.number()]),
    erpContractId: z.union([z.string(), z.number()]).transform(String).nullable().optional(),
  })
  .passthrough();

const dadosPagamentoSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    dueDate: z.string().nullable().optional(),
    amount: z.number(),
    finalAmount: z.number().nullable().optional(),
    pixCode: z.string().nullable().optional(),
    pixQrCodeBase64: z.string().nullable().optional(),
    billetDigitableLine: z.string().nullable().optional(),
    billetBarcodeBase64: z.string().nullable().optional(),
    invoicePDFURL: z.string().url().nullable().optional(),
    negotiationLink: z.string().url().nullable().optional(),
    paymentLink: z.string().url().nullable().optional(),
  })
  .passthrough();

export type BemobiInvoice = z.infer<typeof faturaSchema>;
export type BemobiPaymentData = z.infer<typeof dadosPagamentoSchema>;

export interface BemobiTransportInput {
  url: URL;
  method: "GET" | "POST";
  apiKey: string;
  apiSecret?: string;
  body?: string;
  signal: AbortSignal;
}

export type BemobiTransport = (input: BemobiTransportInput) => Promise<string>;

/** CPF/CNPJ só sai do servidor na query da Bemobi; formatação é removida. */
export function normalizarDocumentoBemobi(valor: string): string {
  const documento = valor.replace(/\D/g, "");
  if (documento.length !== 11 && documento.length !== 14) {
    throw new BemobiConnectionError(
      "invalid_document",
      "Informe um CPF com 11 dígitos ou um CNPJ com 14 dígitos.",
    );
  }
  return documento;
}

function normalizarFaturaId(valor: string): string {
  const id = valor.trim();
  if (!/^[A-Za-z0-9-]{1,100}$/.test(id)) {
    throw new BemobiConnectionError("invalid_invoice", "A identificação da fatura é inválida.");
  }
  return id;
}

function enderecoPublico(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

async function resolverBemobi(signal: AbortSignal) {
  const enderecos = await Promise.race([
    lookup(BEMOBI_HOST, { all: true, verbatim: true }),
    new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
    ),
  ]);
  if (enderecos.length === 0 || enderecos.some(({ address }) => !enderecoPublico(address))) {
    throw new BemobiConnectionError(
      "connection_failed",
      "O endereço oficial da Bemobi não pôde ser validado.",
    );
  }
  return enderecos;
}

function lookupFixado(enderecos: LookupAddress[]): LookupFunction {
  return (hostname, options: LookupOptions, callback) => {
    if (hostname !== BEMOBI_HOST) {
      callback(Object.assign(new Error("Hostname inesperado."), { code: "EHOSTUNREACH" }), "", 0);
      return;
    }
    if (options.all) {
      callback(null, enderecos);
      return;
    }
    const primeiro = enderecos[0];
    if (!primeiro) {
      callback(Object.assign(new Error("Sem endereço resolvido."), { code: "EHOSTUNREACH" }), "", 0);
      return;
    }
    callback(null, primeiro.address, primeiro.family);
  };
}

async function lerResposta(response: IncomingMessage): Promise<string> {
  const tamanho = Number(response.headers["content-length"] ?? "0");
  if (Number.isFinite(tamanho) && tamanho > BEMOBI_RESPONSE_LIMIT) {
    response.destroy();
    throw new BemobiConnectionError("unexpected_response", "A resposta da Bemobi excedeu o limite.");
  }
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of response) {
    const bytes = Buffer.isBuffer(parte) ? parte : Buffer.from(parte);
    total += bytes.length;
    if (total > BEMOBI_RESPONSE_LIMIT) {
      response.destroy();
      throw new BemobiConnectionError("unexpected_response", "A resposta da Bemobi excedeu o limite.");
    }
    partes.push(bytes);
  }
  return Buffer.concat(partes).toString("utf8");
}

async function transportarBemobi(input: BemobiTransportInput): Promise<string> {
  if (input.url.origin !== BEMOBI_BASE_URL || input.url.hostname !== BEMOBI_HOST) {
    throw new BemobiConnectionError("connection_failed", "Destino Bemobi inválido.");
  }
  const enderecos = await resolverBemobi(input.signal);
  return new Promise<string>((resolve, reject) => {
    const body = input.body;
    const request = https.request(
      input.url,
      {
        method: input.method,
        agent: false,
        signal: input.signal,
        lookup: lookupFixado(enderecos),
        servername: BEMOBI_HOST,
        headers: {
          accept: "application/json",
          "accept-encoding": "identity",
          "x-api-key": input.apiKey,
          ...(input.apiSecret ? { "x-api-secret": input.apiSecret } : {}),
          ...(body
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.destroy();
          reject(new BemobiConnectionError("unexpected_response", "A Bemobi tentou redirecionar a requisição."));
          return;
        }
        if (status === 401 || status === 403) {
          response.destroy();
          reject(new BemobiConnectionError("unauthorized", "A Bemobi recusou as credenciais."));
          return;
        }
        if (status === 404) {
          response.destroy();
          reject(new BemobiConnectionError("not_found", "A Bemobi não encontrou o recurso solicitado."));
          return;
        }
        if (status < 200 || status >= 300) {
          response.destroy();
          reject(new BemobiConnectionError("connection_failed", `A Bemobi respondeu HTTP ${status}.`));
          return;
        }
        lerResposta(response).then(resolve, reject);
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

async function executar<T>(
  input: Omit<BemobiTransportInput, "signal">,
  schema: z.ZodType<T>,
  transportar: BemobiTransport,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new BemobiConnectionError("timeout", "A Bemobi não respondeu em 10 segundos.")),
    BEMOBI_TIMEOUT_MS,
  );
  try {
    const raw = await transportar({ ...input, signal: controller.signal });
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new BemobiConnectionError(
        "unexpected_response",
        "O endereço respondeu, mas não retornou JSON da API Bemobi.",
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new BemobiConnectionError(
        "unexpected_response",
        "A Bemobi respondeu em um formato diferente do esperado.",
      );
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof BemobiConnectionError) throw error;
    if (controller.signal.aborted) {
      throw new BemobiConnectionError("timeout", "A Bemobi não respondeu em 10 segundos.");
    }
    throw new BemobiConnectionError("connection_failed", "Não foi possível alcançar a Bemobi.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function listarFaturasBemobi(
  apiKey: string,
  documento: string,
  transportar: BemobiTransport = transportarBemobi,
): Promise<BemobiInvoice[]> {
  const txId = normalizarDocumentoBemobi(documento);
  const url = new URL("/v2/integrations/omnichannel/invoices", BEMOBI_BASE_URL);
  url.searchParams.set("txId", txId);
  return executar(
    { url, method: "GET", apiKey },
    z.array(faturaSchema).max(500),
    transportar,
  );
}

export async function obterDadosPagamentoBemobi(
  apiKey: string,
  faturaId: string,
  transportar: BemobiTransport = transportarBemobi,
): Promise<BemobiPaymentData> {
  const id = normalizarFaturaId(faturaId);
  const url = new URL(
    `/v2/integrations/omnichannel/invoices/${encodeURIComponent(id)}/payment-data`,
    BEMOBI_BASE_URL,
  );
  return executar({ url, method: "GET", apiKey }, dadosPagamentoSchema, transportar);
}

export async function testarConexaoBemobi(
  apiKey: string,
  documento: string,
  transportar: BemobiTransport = transportarBemobi,
): Promise<{ total: number }> {
  const faturas = await listarFaturasBemobi(apiKey, documento, transportar);
  return { total: faturas.length };
}
