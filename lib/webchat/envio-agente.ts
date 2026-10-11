import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type { SendMessageInput } from "@/lib/schemas";
import type { Message } from "@/lib/types/messaging";

/** Deriva uma chave UUID estável do ledger, sem mudar a chave original do recibo MCP. */
export function chaveWebchatDoEnvio(chave: string): string {
  const hex = createHash("sha256").update(chave).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function enviarMensagemWebchatAgente(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  input: SendMessageInput,
  colunas: string,
): Promise<Message> {
  const anexo =
    input.type === "document" && input.media_url
      ? {
          type: "document" as const,
          url: input.media_url,
          mime: input.media_mime ?? "application/pdf",
        }
      : null;
  const urlSegura = anexo ? new URL(anexo.url).protocol === "https:" : true;
  if (
    ctx.actor.type !== "ai_agent" ||
    (!input.body?.trim() && !anexo) ||
    (input.type !== "text" && !anexo) ||
    !urlSegura
  ) {
    throw new ApiError(
      422,
      "validation_failed",
      undefined,
      ctx.requestId,
      "Neste canal o agente pode enviar texto ou documento HTTPS pela sessão web.",
    );
  }
  const chaveOriginal = String(
    input.metadata?.idempotency_key ?? ctx.internalMessageId ?? randomUUID(),
  );
  const messageId = ctx.internalMessageId ?? randomUUID();
  const { data, error } = await supabase.rpc("fn_enviar_mensagem_webchat_agente", {
    p_organization_id: ctx.organization_id,
    p_conversation_id: input.conversation_id,
    p_message_id: messageId,
    p_idempotency_key: chaveWebchatDoEnvio(chaveOriginal),
    p_body: input.body?.trim() || "Fatura em PDF.",
    p_metadata: {
      ...(input.metadata ?? {}),
      idempotency_key: chaveOriginal,
      ai_actor_id: ctx.actor.id,
      ...(anexo ? { webchat_attachment: anexo } : {}),
    },
    p_service_revision: ctx.serviceBoundary?.service_revision ?? null,
  });
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  const receipt = data as { ok?: boolean; reason?: string; message_id?: string } | null;
  if (!receipt?.ok || !receipt.message_id) {
    throw new ApiError(
      409,
      "conflict",
      { reason: receipt?.reason },
      ctx.requestId,
      "A sessão web não está disponível para resposta automática.",
    );
  }
  const { data: message, error: readError } = await supabase
    .from("messages")
    .select(colunas)
    .eq("organization_id", ctx.organization_id)
    .eq("conversation_id", input.conversation_id)
    .eq("id", receipt.message_id)
    .single();
  if (readError || !message) {
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      ctx.requestId,
      "A resposta foi entregue no webchat, mas o recibo não pôde ser lido.",
    );
  }
  return message as unknown as Message;
}
