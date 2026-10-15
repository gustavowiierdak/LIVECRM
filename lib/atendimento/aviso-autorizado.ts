import type { SupabaseClient } from "@supabase/supabase-js";
import { StaleServiceBoundaryError } from "./fronteira";

export interface AttendanceNoticeContext {
  noticeId: string;
}

/** Autorização estreita para aviso de ciclo de vida, inclusive após fechar.
 * Não reabre conversa nem autoriza texto livre em um episódio encerrado. */
export async function assertAttendanceNotice(
  admin: SupabaseClient,
  org: string,
  conversationId: string,
  body: string | undefined,
  context: AttendanceNoticeContext,
): Promise<void> {
  const { data: notice, error } = await admin
    .from("attendance_notices")
    .select("protocol,kind,body,assigned_to_user_id")
    .eq("id", context.noticeId)
    .eq("organization_id", org)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) throw error;
  if (!notice || notice.body !== body) throw new StaleServiceBoundaryError();
  const { data: conv, error: convError } = await admin
    .from("conversations")
    .select("service_protocol,status,assigned_to_user_id,channel,is_group")
    .eq("id", conversationId)
    .eq("organization_id", org)
    .maybeSingle();
  if (convError) throw convError;
  if (
    !conv ||
    conv.is_group ||
    conv.channel === "webchat" ||
    conv.service_protocol !== notice.protocol ||
    (notice.kind === "encerrado") !== ["closed", "resolved", "archived"].includes(conv.status) ||
    (notice.kind === "assumido" && notice.assigned_to_user_id !== conv.assigned_to_user_id)
  )
    throw new StaleServiceBoundaryError();
}
