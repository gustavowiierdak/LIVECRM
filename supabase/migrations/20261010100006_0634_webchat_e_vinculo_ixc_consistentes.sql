-- manifest: Restaura a resposta idempotente do WebChat após o fechamento visível e classifica o vínculo IXC como fato de auditoria concluído.

-- Restaura a versao idempotente da entrada do visitante depois que a 0631
-- passou a impedir escrita em conversas encerradas. A redefinicao da 0631
-- preservou o fechamento, mas perdeu `new_message`, organization/conversation
-- e a validacao de corpo da 0613; sem esses campos o endpoint nao consegue
-- decidir com seguranca se deve acordar o agente de IA.
create or replace function public.fn_registrar_mensagem_webchat_visitante(
  p_session_digest text,p_csrf_digest text,p_origin text,p_body text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_session public.webchat_visitor_sessions%rowtype;
  v_message public.webchat_messages%rowtype;
  v_criada boolean:=false;
begin
  select s.* into v_session from public.webchat_visitor_sessions s
  join public.webchat_channel_configs cfg on cfg.organization_id=s.organization_id
  join public.contacts ct on ct.id=s.contact_id and ct.organization_id=s.organization_id
  join public.conversations conv on conv.id=s.source_conversation_id and conv.organization_id=s.organization_id
  where s.session_digest=p_session_digest and s.csrf_digest=p_csrf_digest
    and s.expires_at>now() and s.revoked_at is null and cfg.enabled=true
    and p_origin=any(cfg.allowed_origins) and ct.is_blocked=false
    and ct.is_anonymized=false and conv.status not in ('closed','resolved','archived')
  for update of s;
  if not found then return jsonb_build_object('ok',false,'reason','conversation_closed'); end if;
  if char_length(trim(p_body)) not between 1 and 4000 then
    return jsonb_build_object('ok',false);
  end if;
  insert into public.webchat_messages
    (organization_id,visitor_session_id,source_conversation_id,direction,body,idempotency_key)
  values (v_session.organization_id,v_session.id,v_session.source_conversation_id,
          'visitor',trim(p_body),p_idempotency_key)
  on conflict (visitor_session_id,direction,idempotency_key) do nothing
  returning * into v_message;
  v_criada:=found;
  if v_criada then
    perform public.fn_mark_conversation_message(v_session.source_conversation_id,
      'inbound',left(v_message.body,160),v_message.created_at);
  else
    select * into v_message from public.webchat_messages
    where visitor_session_id=v_session.id and direction='visitor'
      and idempotency_key=p_idempotency_key;
  end if;
  return jsonb_build_object('ok',true,'new_message',v_criada,
    'organization_id',v_session.organization_id,
    'conversation_id',v_session.source_conversation_id,
    'message',jsonb_build_object('id',v_message.id,'direction',v_message.direction,
      'body',v_message.body,'created_at',v_message.created_at));
end; $$;
revoke execute on function public.fn_registrar_mensagem_webchat_visitante(text,text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.fn_registrar_mensagem_webchat_visitante(text,text,text,text,uuid)
  to service_role;

-- O vinculo com o cadastro do IXC e um fato de auditoria, nao um comando. Sem
-- consumidor ele deve nascer `done`, como os demais eventos contact.* da lista.
create or replace function public.fn_event_log_e_registro(p_event_type text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select p_event_type = any (array[
    -- IA e agente
    'ai.responded',
    'ai_agent.created',
    'ai_agent.published',
    'ai_agent.run_completed',
    'ai_agent.run_failed',
    'ai_agent.run_started',
    -- agente (harness) — o motor registra quando não há negócio para pendurar
    'agent.activity_unrouted',
    -- canal e conversa
    'channel_session.status_changed',
    'conversation.claimed',
    'conversation.transferred',
    'whatsapp.chat_id_not_recognized',
    'whatsapp.conversation_mark_failed',
    -- contato, lead, organização e plataforma ('lead.reopened' saiu na 0534)
    'contact.anonymized',
    'contact.created',
    'contact.deleted',
    'contact.ixc_linked',
    'contact.updated',
    'crm.activity_write_failed',
    'incident.resolved',
    'lead.bulk_assigned',
    'lead.bulk_deleted',
    'lead.bulk_tagged',
    'lead.risk_backlog_seeded',
    'lead.updated',
    'org.updated',
    'tenant.onboarded',
    'tenant.reactivated',
    'tenant.suspended',
    'user.profile_updated',
    -- mensagem ('message.failed' SAIU aqui na 0417: ele tem consumidor)
    'message.outbound',
    'message.sending',
    'message.sent',
    -- LGPD
    'lgpd.export_delivered',
    'lgpd.export_generated',
    'lgpd.redact_applied',
    'lgpd.redact_failed'
  ]::text[]);
$$;

revoke all on function public.fn_event_log_e_registro(text) from public, anon;
grant execute on function public.fn_event_log_e_registro(text) to authenticated, service_role;

notify pgrst,'reload schema';
