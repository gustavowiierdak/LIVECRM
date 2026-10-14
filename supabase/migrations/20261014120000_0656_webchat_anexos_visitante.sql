-- manifest: Permite imagem e áudio do visitante no atendimento web, com posse validada por sessão e mídia privada espelhada na Inbox.

create or replace function public.fn_webchat_alvo_anexo(
  p_session_digest text, p_csrf_digest text, p_origin text
) returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object('ok',true,'organization_id',s.organization_id,
    'conversation_id',s.source_conversation_id,'visitor_session_id',s.id,
    'public_id',cfg.public_id)
  from public.webchat_visitor_sessions s
  join public.webchat_channel_configs cfg on cfg.organization_id=s.organization_id
  join public.contacts ct on ct.id=s.contact_id and ct.organization_id=s.organization_id
  join public.conversations conv on conv.id=s.source_conversation_id
    and conv.organization_id=s.organization_id
  where s.session_digest=p_session_digest and s.csrf_digest=p_csrf_digest
    and s.expires_at>now() and s.revoked_at is null and cfg.enabled=true
    and p_origin=any(cfg.allowed_origins) and ct.is_blocked=false
    and ct.is_anonymized=false and conv.channel='webchat'
    and conv.status not in ('closed','resolved','archived')
  limit 1;
$$;
revoke execute on function public.fn_webchat_alvo_anexo(text,text,text)
  from public,anon,authenticated;
grant execute on function public.fn_webchat_alvo_anexo(text,text,text) to service_role;

create or replace function public.fn_registrar_anexo_webchat_visitante(
  p_session_digest text,p_csrf_digest text,p_origin text,p_storage_path text,
  p_mime text,p_kind text,p_size_bytes integer,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_session public.webchat_visitor_sessions%rowtype;
  v_message public.webchat_messages%rowtype;
  v_criada boolean:=false;
  v_body text;
begin
  select s.* into v_session from public.webchat_visitor_sessions s
  join public.webchat_channel_configs cfg on cfg.organization_id=s.organization_id
  join public.contacts ct on ct.id=s.contact_id and ct.organization_id=s.organization_id
  join public.conversations conv on conv.id=s.source_conversation_id
    and conv.organization_id=s.organization_id
  where s.session_digest=p_session_digest and s.csrf_digest=p_csrf_digest
    and s.expires_at>now() and s.revoked_at is null and cfg.enabled=true
    and p_origin=any(cfg.allowed_origins) and ct.is_blocked=false
    and ct.is_anonymized=false and conv.channel='webchat'
    and conv.status not in ('closed','resolved','archived')
  for update of s;
  if not found then return jsonb_build_object('ok',false,'reason','conversation_closed'); end if;
  if p_kind not in ('image','audio') or p_size_bytes not between 1 and 10485760
    or (p_kind='image' and p_mime not in ('image/jpeg','image/png','image/webp','image/gif'))
    or (p_kind='audio' and p_mime not in ('audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/wav'))
    or p_storage_path !~ ('^'||v_session.organization_id::text||'/'||v_session.source_conversation_id::text||'/webchat-[0-9a-f-]{36}\.[a-z0-9]{2,5}$')
  then return jsonb_build_object('ok',false,'reason','invalid_media'); end if;
  v_body:=case when p_kind='image' then 'Imagem enviada' else 'Áudio enviado' end;
  insert into public.webchat_messages
    (organization_id,visitor_session_id,source_conversation_id,direction,body,
     idempotency_key,metadata)
  values (v_session.organization_id,v_session.id,v_session.source_conversation_id,
    'visitor',v_body,p_idempotency_key,
    jsonb_build_object('webchat_media',jsonb_build_object('kind',p_kind,
      'mime',p_mime,'storage_path',p_storage_path,'size_bytes',p_size_bytes)))
  on conflict (visitor_session_id,direction,idempotency_key) do nothing
  returning * into v_message;
  v_criada:=found;
  if v_criada then
    perform public.fn_mark_conversation_message(v_session.source_conversation_id,
      'inbound',v_body,v_message.created_at);
  else
    select * into v_message from public.webchat_messages
    where visitor_session_id=v_session.id and direction='visitor'
      and idempotency_key=p_idempotency_key;
  end if;
  return jsonb_build_object('ok',true,'new_message',v_criada,
    'organization_id',v_session.organization_id,
    'conversation_id',v_session.source_conversation_id,
    'message',jsonb_build_object('id',v_message.id,'direction',v_message.direction,
      'body',v_message.body,'type',coalesce(v_message.metadata #>> '{webchat_media,kind}','text'),
      'media_mime',v_message.metadata #>> '{webchat_media,mime}',
      'created_at',v_message.created_at));
end; $$;
revoke execute on function public.fn_registrar_anexo_webchat_visitante(text,text,text,text,text,text,integer,uuid)
  from public,anon,authenticated;
grant execute on function public.fn_registrar_anexo_webchat_visitante(text,text,text,text,text,text,integer,uuid)
  to service_role;

create or replace function public.fn_webchat_espelhar_mensagem()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_conversa public.conversations%rowtype;
  v_eh_pdf boolean := new.direction='operator'
    and new.metadata #>> '{webchat_attachment,type}'='document'
    and new.metadata #>> '{webchat_attachment,mime}'='application/pdf'
    and new.metadata #>> '{webchat_attachment,url}' like 'https://%';
  v_kind text := new.metadata #>> '{webchat_media,kind}';
begin
  if new.direction not in ('visitor','operator') then return new; end if;
  select * into v_conversa from public.conversations
    where id=new.source_conversation_id and organization_id=new.organization_id;
  if not found or v_conversa.channel <> 'webchat' then return new; end if;
  insert into public.messages
    (id,organization_id,conversation_id,channel_session_id,contact_id,
     type,direction,status,body,media_url,media_mime,media_storage_path,
     media_size_bytes,sent_via,sent_by_user_id,sent_at,metadata)
  values (new.id,new.organization_id,v_conversa.id,v_conversa.channel_session_id,
    v_conversa.contact_id,case when v_kind in ('image','audio') then v_kind
      when v_eh_pdf then 'document' else 'text' end,
    case when new.direction='visitor' then 'inbound' else 'outbound' end,
    case when new.direction='visitor' then 'received' else 'sent' end,
    new.body,case when v_eh_pdf then new.metadata #>> '{webchat_attachment,url}' else null end,
    case when v_kind in ('image','audio') then new.metadata #>> '{webchat_media,mime}'
      when v_eh_pdf then 'application/pdf' else null end,
    case when v_kind in ('image','audio') then new.metadata #>> '{webchat_media,storage_path}' else null end,
    case when v_kind in ('image','audio') then (new.metadata #>> '{webchat_media,size_bytes}')::integer else null end,
    case when new.direction='visitor' then 'crm'
      when new.sent_by_user_id is not null then 'user' else 'ai' end,
    new.sent_by_user_id,new.created_at,
    coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('webchat_visitor_session_id',new.visitor_session_id))
  on conflict (id) do nothing;
  return new;
end; $$;
revoke execute on function public.fn_webchat_espelhar_mensagem() from public,anon,authenticated;
grant execute on function public.fn_webchat_espelhar_mensagem() to service_role;
notify pgrst,'reload schema';
