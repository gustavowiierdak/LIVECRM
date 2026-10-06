import { createHash, randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

export const setoresWebchat = ["suporte", "financeiro", "cancelamento"] as const;
export const setorWebchatSchema = z.enum(setoresWebchat);
export const mensagemWebchatSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  idempotency_key: z.string().uuid(),
});

export const WEBCHAT_SESSION_COOKIE = "webchat_visitante";
export const WEBCHAT_CSRF_COOKIE = "webchat_csrf";

export type CredencialOpaca = Readonly<{ raw: string; digest: string }>;

/** O valor que cruza a tela só existe no cookie/response; o banco recebe SHA-256. */
export function novaCredencialOpaca(): CredencialOpaca {
  const raw = randomBytes(32).toString("base64url");
  return { raw, digest: digestWebchat(raw) };
}

export function digestWebchat(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function novaChaveIdempotente(): string {
  return randomUUID();
}

/**
 * O Origin é a segunda barreira para o cookie Strict. Nunca aceitamos Origin
 * ausente nem com caminho/query: a allowlist do banco guarda somente origins.
 */
export function originDaRequisicao(request: Request): string | null {
  const raw = request.headers.get("origin");
  if (!raw) return null;
  try {
    const origin = new URL(raw).origin;
    return origin === raw ? origin : null;
  } catch {
    return null;
  }
}

export function opcoesCookieWebchat(expiresAt: string, httpOnly: boolean) {
  const expires = new Date(expiresAt);
  return {
    httpOnly,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    // A tela vive em `/atendimento`, mas a sessão só é consumida pelos handlers
    // em `/api/public/webchat/*`; restringir para a página impediria o browser
    // de levar o cookie no POST seguro. Origin + CSRF seguem sendo os limites.
    path: "/",
    expires: Number.isNaN(expires.valueOf()) ? undefined : expires,
  };
}
