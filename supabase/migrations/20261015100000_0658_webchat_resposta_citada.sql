-- manifest: Resposta citada no chat web, com referência validada na mesma sessão e gravação atômica/idempotente junto à mensagem.
create or replace function public.fn_responder_mensagem_webchat_operador(
  p_organization_id uuid, p_source_conversation_id uuid, p_visitor_session_id uuid,
  p_body text, p_idempotency_key uuid, p_sent_by_user_id uuid, p_reply_to_message_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_citada public.webchat_messages%rowtype;
  v_quote jsonb;
  v_result jsonb;
  v_message_id uuid;
  v_existing boolean;
  v_sender text;
begin
  if not exists (select 1 from public.user_organizations
    where organization_id = p_organization_id and user_id = p_sent_by_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_reply');
  end if;

  -- Serializa também a checagem de idempotência; uma repetição não troca a citação.
  perform 1 from public.webchat_visitor_sessions
    where id = p_visitor_session_id and organization_id = p_organization_id
      and source_conversation_id = p_source_conversation_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid_reply'); end if;

  select * into v_citada from public.webchat_messages
    where id = p_reply_to_message_id and organization_id = p_organization_id
      and source_conversation_id = p_source_conversation_id
      and visitor_session_id = p_visitor_session_id and direction in ('visitor', 'operator');
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid_reply'); end if;

  if v_citada.direction = 'operator' and v_citada.sent_by_user_id is not null then
    select nullif(btrim(u.raw_user_meta_data->>'full_name'), '') into v_sender
      from auth.users u join public.user_organizations m on m.user_id = u.id
      where m.organization_id = p_organization_id and u.id = v_citada.sent_by_user_id;
  elsif v_citada.direction = 'operator' then
    select nullif(btrim(name), '') into v_sender from public.ai_agents
      where organization_id = p_organization_id and id::text = v_citada.metadata->>'ai_actor_id';
  end if;
  v_quote := jsonb_build_object('id', v_citada.id, 'direction', v_citada.direction,
    'sender_name', left(v_sender, 300), 'body', left(v_citada.body, 1000), 'created_at', v_citada.created_at);

  select exists (select 1 from public.webchat_messages
    where organization_id = p_organization_id and visitor_session_id = p_visitor_session_id
      and source_conversation_id = p_source_conversation_id
      and direction = 'operator' and idempotency_key = p_idempotency_key) into v_existing;

  -- Reutiliza o envio: validade da sessão, encerramento, revisão, timeline e push.
  v_result := public.fn_enviar_mensagem_webchat_operador(p_organization_id,
    p_source_conversation_id, p_visitor_session_id, p_body, p_idempotency_key, p_sent_by_user_id);
  if coalesce((v_result->>'ok')::boolean, false) is not true then return v_result; end if;
  v_message_id := (v_result #>> '{message,id}')::uuid;
  if not v_existing then
    update public.webchat_messages set metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('webchat_reply', v_quote)
      where id = v_message_id and organization_id = p_organization_id
        and visitor_session_id = p_visitor_session_id
        and source_conversation_id = p_source_conversation_id;
  end if;
  select metadata->'webchat_reply' into v_quote from public.webchat_messages
    where id = v_message_id and organization_id = p_organization_id
      and visitor_session_id = p_visitor_session_id and source_conversation_id = p_source_conversation_id;
  return jsonb_set(v_result, '{message}', (v_result->'message')
    || jsonb_build_object('reply_to', v_quote));
end; $$;
revoke all on function public.fn_responder_mensagem_webchat_operador(uuid,uuid,uuid,text,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.fn_responder_mensagem_webchat_operador(uuid,uuid,uuid,text,uuid,uuid,uuid)
  to service_role;
-- A citação contém texto do atendimento e acompanha sua anonimização.
create or replace function public.fn_webchat_redigir_contato()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.webchat_messages m
    set body = '[mensagem anonimizada]', metadata = coalesce(m.metadata, '{}'::jsonb) - 'webchat_reply'
    from public.webchat_visitor_sessions s
    where m.visitor_session_id = s.id and s.organization_id = new.organization_id
      and m.organization_id = new.organization_id and s.contact_id = new.id
      and (m.body <> '[mensagem anonimizada]' or m.metadata ? 'webchat_reply');
  update public.webchat_visitor_sessions set revoked_at = now()
    where organization_id = new.organization_id and contact_id = new.id and revoked_at is null;
  update public.webchat_handoffs set revoked_at = now()
    where organization_id = new.organization_id and contact_id = new.id and revoked_at is null;
  return new;
end; $$;
revoke all on function public.fn_webchat_redigir_contato() from public, anon, authenticated;
grant execute on function public.fn_webchat_redigir_contato() to service_role;
notify pgrst, 'reload schema';
