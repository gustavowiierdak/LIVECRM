-- manifest: Liga o atendimento web ao histórico canônico do agente sem trocar o transporte; respostas da IA são entregues pela sessão web, com idempotência e veto à posse humana.

alter table public.webchat_messages
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- O canal precisa existir ANTES do primeiro visitante para a equipe associar
-- o agente/roteador pela tela. Atualizações antigas são curadas uma vez.
create or replace function public.fn_assegurar_sessao_webchat(p_org uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_cfg public.webchat_channel_configs%rowtype; v_id uuid;
begin
  select * into v_cfg from public.webchat_channel_configs
    where organization_id=p_org and enabled=true for update;
  if not found then return null; end if;
  if v_cfg.channel_session_id is not null then return v_cfg.channel_session_id; end if;
  insert into public.channel_sessions
    (organization_id,provider,waha_session_name,webhook_secret_encrypted,status,display_name)
  values (p_org,'webchat',null,extensions.gen_random_bytes(32),'WORKING','Atendimento web')
  returning id into v_id;
  update public.webchat_channel_configs set channel_session_id=v_id,updated_at=now()
    where organization_id=p_org;
  return v_id;
end; $$;
revoke execute on function public.fn_assegurar_sessao_webchat(uuid) from public,anon,authenticated;
grant execute on function public.fn_assegurar_sessao_webchat(uuid) to service_role;
do $$ declare v_org uuid; begin
  for v_org in select organization_id from public.webchat_channel_configs
    where enabled=true and channel_session_id is null loop
    perform public.fn_assegurar_sessao_webchat(v_org);
  end loop;
end $$;

-- Não deixar um webchat sem agente explícito cair no bot genérico da empresa.
-- O roteador só conta quando ao menos um destino tem versão publicada.
create or replace function public.fn_webchat_tem_agente_configurado(
  p_org uuid,p_channel_session_id uuid
) returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.ai_agents a
    join public.ai_agent_versions v on v.id=a.published_version_id
    where a.organization_id=p_org and a.archived_at is null
      and v.status='published' and v.channel_session_id=p_channel_session_id
  ) or exists (
    select 1 from public.ai_routers r
    join public.ai_agents a on a.id=r.fallback_agent_id and a.organization_id=r.organization_id
    join public.ai_agent_versions v on v.id=a.published_version_id
    where r.organization_id=p_org and r.channel_session_id=p_channel_session_id
      and r.is_active=true and a.archived_at is null and v.status='published'
  ) or exists (
    select 1 from public.ai_routers r
    join public.ai_router_members m on m.router_id=r.id and m.organization_id=r.organization_id
    join public.ai_agents a on a.id=m.agent_id and a.organization_id=r.organization_id
    join public.ai_agent_versions v on v.id=a.published_version_id
    where r.organization_id=p_org and r.channel_session_id=p_channel_session_id
      and r.is_active=true and a.archived_at is null and v.status='published'
  );
$$;
revoke execute on function public.fn_webchat_tem_agente_configurado(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.fn_webchat_tem_agente_configurado(uuid,uuid) to service_role;

-- A mesma identidade nas duas timelines permite que caso, demanda, auditoria,
-- anti-backlog e encerramento leiam a conversa sem inferir textos por proximidade.
create or replace function public.fn_webchat_espelhar_mensagem()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_conversa public.conversations%rowtype;
begin
  if new.direction not in ('visitor', 'operator') then return new; end if;
  select * into v_conversa from public.conversations
   where id=new.source_conversation_id and organization_id=new.organization_id;
  -- Handoff por código continua humano e ligado à conversa original; não
  -- espelhar ali, senão a IA responderia pelo transporte da conversa antiga.
  if not found or v_conversa.channel <> 'webchat' then return new; end if;
  insert into public.messages
    (id, organization_id, conversation_id, channel_session_id, contact_id,
     type, direction, status, body, sent_via, sent_by_user_id, sent_at,
     metadata)
  values
    (new.id, new.organization_id, v_conversa.id, v_conversa.channel_session_id,
     v_conversa.contact_id, 'text',
     case when new.direction='visitor' then 'inbound' else 'outbound' end,
     case when new.direction='visitor' then 'received' else 'sent' end,
     new.body,
     case when new.direction='visitor' then 'crm'
          when new.sent_by_user_id is not null then 'user' else 'ai' end,
     new.sent_by_user_id, new.created_at,
     coalesce(new.metadata, '{}'::jsonb) ||
       jsonb_build_object('webchat_visitor_session_id', new.visitor_session_id))
  on conflict (id) do nothing;
  return new;
end; $$;
revoke execute on function public.fn_webchat_espelhar_mensagem() from public, anon, authenticated;
grant execute on function public.fn_webchat_espelhar_mensagem() to service_role;
drop trigger if exists trg_webchat_espelhar_mensagem on public.webchat_messages;
create trigger trg_webchat_espelhar_mensagem after insert on public.webchat_messages
  for each row execute function public.fn_webchat_espelhar_mensagem();

-- A Inbox distingue a resposta do agente da resposta de uma pessoa; o portal
-- público continua vendo só direção, corpo e horário.
create or replace function public.fn_ler_mensagens_webchat_operador(
  p_organization_id uuid,p_source_conversation_id uuid,p_visitor_session_id uuid
) returns jsonb language sql security definer set search_path=public stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'direction',m.direction,'body',m.body,'created_at',m.created_at,
    'sender_kind',case when m.direction='operator' and m.sent_by_user_id is null
      then 'ai' when m.direction='operator' then 'human' else null end
  ) order by m.created_at asc),'[]'::jsonb)
  from public.webchat_messages m
  join public.webchat_visitor_sessions s on s.id=m.visitor_session_id
  where m.organization_id=p_organization_id
    and m.source_conversation_id=p_source_conversation_id
    and m.visitor_session_id=p_visitor_session_id
    and s.organization_id=p_organization_id
    and s.source_conversation_id=p_source_conversation_id;
$$;
revoke execute on function public.fn_ler_mensagens_webchat_operador(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.fn_ler_mensagens_webchat_operador(uuid,uuid,uuid) to service_role;

-- Sessão pública nova é automática; sessão de handoff de uma conversa existente
-- preserva a posse daquela conversa. A vinculação do agente é feita no roteador.
create or replace function public.fn_iniciar_webchat_publico(
  p_public_id uuid, p_origin text, p_name text, p_sector text, p_body text,
  p_session_digest text, p_csrf_digest text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_config public.webchat_channel_configs%rowtype;
  v_channel_id uuid; v_contact_id uuid; v_conversation_id uuid;
  v_visitor_id uuid; v_message_id uuid; v_created_at timestamptz;
begin
  select * into v_config from public.webchat_channel_configs
   where public_id=p_public_id and enabled=true and p_origin=any(allowed_origins)
     and p_sector=any(allowed_sectors) for update;
  if not found then return jsonb_build_object('ok',false); end if;
  if char_length(trim(p_name)) not between 2 and 80 or
     char_length(trim(p_body)) not between 1 and 4000 or
     p_session_digest !~ '^[0-9a-f]{64}$' or p_csrf_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok',false);
  end if;
  v_channel_id:=v_config.channel_session_id;
  if v_channel_id is null then
    insert into public.channel_sessions
      (organization_id,provider,waha_session_name,webhook_secret_encrypted,status,display_name)
    values (v_config.organization_id,'webchat',null,extensions.gen_random_bytes(32),
            'WORKING','Atendimento web') returning id into v_channel_id;
    update public.webchat_channel_configs set channel_session_id=v_channel_id,
      updated_at=now() where organization_id=v_config.organization_id;
  end if;
  insert into public.contacts
    (organization_id,name,display_name,source,force_human)
  values (v_config.organization_id,trim(p_name),trim(p_name),'webchat',
          not public.fn_webchat_tem_agente_configurado(v_config.organization_id,v_channel_id))
  returning id into v_contact_id;
  insert into public.conversations
    (organization_id,contact_id,channel_session_id,channel,status)
  values (v_config.organization_id,v_contact_id,v_channel_id,'webchat','open')
  returning id into v_conversation_id;
  insert into public.webchat_visitor_sessions
    (organization_id,contact_id,source_conversation_id,sector,
     session_digest,csrf_digest,expires_at)
  values (v_config.organization_id,v_contact_id,v_conversation_id,p_sector,
          p_session_digest,p_csrf_digest,now()+interval '7 days')
  returning id into v_visitor_id;
  insert into public.webchat_messages
    (organization_id,visitor_session_id,source_conversation_id,
     direction,body,idempotency_key)
  values (v_config.organization_id,v_visitor_id,v_conversation_id,
          'visitor',trim(p_body),p_idempotency_key)
  returning id,created_at into v_message_id,v_created_at;
  perform public.fn_mark_conversation_message(v_conversation_id,'inbound',left(trim(p_body),160),v_created_at);
  return jsonb_build_object('ok',true,'sector',p_sector,
    'organization_id',v_config.organization_id,'conversation_id',v_conversation_id,
    'expires_at',now()+interval '7 days',
    'message',jsonb_build_object('id',v_message_id,'direction','visitor',
      'body',trim(p_body),'created_at',v_created_at));
end; $$;
revoke execute on function public.fn_iniciar_webchat_publico(uuid,text,text,text,text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.fn_iniciar_webchat_publico(uuid,text,text,text,text,text,text,uuid)
  to service_role;

-- O flag de criação impede que uma retransmissão HTTP acorde a IA duas vezes.
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

-- Só a IA (via service role do handler) chama esta porta. O banco revalida posse
-- e vida da sessão sob lock antes de criar QUALQUER balão; trigger cria recibo
-- canônico no mesmo commit para o ledger e para a prova de encerramento.
create or replace function public.fn_enviar_mensagem_webchat_agente(
  p_organization_id uuid,p_conversation_id uuid,p_message_id uuid,
  p_idempotency_key uuid,p_body text,p_metadata jsonb,p_service_revision bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_session public.webchat_visitor_sessions%rowtype;
  v_message public.webchat_messages%rowtype;
begin
  if char_length(trim(p_body)) not between 1 and 4000 then
    return jsonb_build_object('ok',false,'reason','invalid_body');
  end if;
  select s.* into v_session from public.webchat_visitor_sessions s
  join public.webchat_channel_configs cfg on cfg.organization_id=s.organization_id
  join public.conversations conv on conv.id=s.source_conversation_id and conv.organization_id=s.organization_id
  join public.contacts ct on ct.id=conv.contact_id and ct.organization_id=conv.organization_id
  where s.organization_id=p_organization_id and s.source_conversation_id=p_conversation_id
    and s.expires_at>now() and s.revoked_at is null and cfg.enabled=true
    and conv.channel='webchat' and conv.status in ('open','pending','ai_handling')
    and (p_service_revision is null or conv.service_revision=p_service_revision)
    and conv.assigned_to_user_id is null
    and (conv.assignee_kind is null or conv.assignee_kind='ai')
    and (conv.bot_silenced_until is null or conv.bot_silenced_until<now())
    and ct.force_human=false and ct.is_blocked=false and ct.is_personal=false
    and ct.is_anonymized=false
  order by s.created_at desc limit 1 for update of s,conv,ct;
  if not found then return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  insert into public.webchat_messages
    (id,organization_id,visitor_session_id,source_conversation_id,
     direction,body,idempotency_key,metadata)
  values (p_message_id,p_organization_id,v_session.id,p_conversation_id,
          'operator',trim(p_body),p_idempotency_key,coalesce(p_metadata,'{}'::jsonb))
  on conflict (visitor_session_id,direction,idempotency_key) do nothing
  returning * into v_message;
  if found then
    perform public.fn_mark_conversation_message(p_conversation_id,'outbound',
      left(v_message.body,160),v_message.created_at);
  else
    select * into v_message from public.webchat_messages
    where visitor_session_id=v_session.id and direction='operator'
      and idempotency_key=p_idempotency_key;
    if v_message.body<>trim(p_body) or
       v_message.metadata->>'idempotency_key' is distinct from
         p_metadata->>'idempotency_key' then
      return jsonb_build_object('ok',false,'reason','idempotency_conflict');
    end if;
  end if;
  return jsonb_build_object('ok',true,'message_id',v_message.id);
end; $$;
revoke execute on function public.fn_enviar_mensagem_webchat_agente(uuid,uuid,uuid,uuid,text,jsonb,bigint)
  from public,anon,authenticated;
grant execute on function public.fn_enviar_mensagem_webchat_agente(uuid,uuid,uuid,uuid,text,jsonb,bigint)
  to service_role;

notify pgrst,'reload schema';
