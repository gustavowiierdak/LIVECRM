-- manifest: O atendimento web entrega PDF como documento real, sem expor metadados internos nem trocar o transporte do canal.

-- O anexo continua guardado no metadata privado da linha web. A timeline publica
-- recebe somente tipo, URL HTTPS e MIME validados; nenhum outro metadata do turno
-- ou da ferramenta financeira atravessa a fronteira.
create or replace function public.fn_webchat_espelhar_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversa public.conversations%rowtype;
  v_eh_pdf boolean :=
    new.direction = 'operator'
    and new.metadata #>> '{webchat_attachment,type}' = 'document'
    and new.metadata #>> '{webchat_attachment,mime}' = 'application/pdf'
    and new.metadata #>> '{webchat_attachment,url}' like 'https://%';
begin
  if new.direction not in ('visitor', 'operator') then return new; end if;

  select * into v_conversa
  from public.conversations
  where id = new.source_conversation_id
    and organization_id = new.organization_id;

  if not found or v_conversa.channel <> 'webchat' then return new; end if;

  insert into public.messages (
    id, organization_id, conversation_id, channel_session_id, contact_id,
    type, direction, status, body, media_url, media_mime, sent_via,
    sent_by_user_id, sent_at, metadata
  )
  values (
    new.id,
    new.organization_id,
    v_conversa.id,
    v_conversa.channel_session_id,
    v_conversa.contact_id,
    case when v_eh_pdf then 'document' else 'text' end,
    case when new.direction = 'visitor' then 'inbound' else 'outbound' end,
    case when new.direction = 'visitor' then 'received' else 'sent' end,
    new.body,
    case when v_eh_pdf then new.metadata #>> '{webchat_attachment,url}' else null end,
    case when v_eh_pdf then 'application/pdf' else null end,
    case
      when new.direction = 'visitor' then 'crm'
      when new.sent_by_user_id is not null then 'user'
      else 'ai'
    end,
    new.sent_by_user_id,
    new.created_at,
    coalesce(new.metadata, '{}'::jsonb)
      || jsonb_build_object('webchat_visitor_session_id', new.visitor_session_id)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.fn_webchat_espelhar_mensagem()
  from public, anon, authenticated;
grant execute on function public.fn_webchat_espelhar_mensagem()
  to service_role;

create or replace function public.fn_ler_mensagens_webchat_visitante(
  p_session_digest text,
  p_origin text
) returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'direction', m.direction,
          'type', case
            when m.direction = 'operator'
              and m.metadata #>> '{webchat_attachment,type}' = 'document'
              and m.metadata #>> '{webchat_attachment,mime}' = 'application/pdf'
              and m.metadata #>> '{webchat_attachment,url}' like 'https://%'
            then 'document'
            else 'text'
          end,
          'body', m.body,
          'media_url', case
            when m.direction = 'operator'
              and m.metadata #>> '{webchat_attachment,type}' = 'document'
              and m.metadata #>> '{webchat_attachment,mime}' = 'application/pdf'
              and m.metadata #>> '{webchat_attachment,url}' like 'https://%'
            then m.metadata #>> '{webchat_attachment,url}'
            else null
          end,
          'media_mime', case
            when m.direction = 'operator'
              and m.metadata #>> '{webchat_attachment,type}' = 'document'
              and m.metadata #>> '{webchat_attachment,mime}' = 'application/pdf'
              and m.metadata #>> '{webchat_attachment,url}' like 'https://%'
            then 'application/pdf'
            else null
          end,
          'created_at', m.created_at
        )
        order by m.created_at asc
      )
      from public.webchat_messages m
      where m.visitor_session_id = s.id
    ),
    '[]'::jsonb
  )
  from public.webchat_visitor_sessions s
  join public.webchat_channel_configs c
    on c.organization_id = s.organization_id
  where s.session_digest = p_session_digest
    and s.expires_at > now()
    and s.revoked_at is null
    and c.enabled = true
    and p_origin = any(c.allowed_origins)
  limit 1;
$$;

revoke execute on function public.fn_ler_mensagens_webchat_visitante(text, text)
  from public, anon, authenticated;
grant execute on function public.fn_ler_mensagens_webchat_visitante(text, text)
  to service_role;

create or replace function public.fn_ler_mensagens_webchat_operador(
  p_organization_id uuid,
  p_source_conversation_id uuid,
  p_visitor_session_id uuid
) returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'direction', m.direction,
        'type', case
          when m.direction = 'operator'
            and m.metadata #>> '{webchat_attachment,type}' = 'document'
            and m.metadata #>> '{webchat_attachment,mime}' = 'application/pdf'
            and m.metadata #>> '{webchat_attachment,url}' like 'https://%'
          then 'document'
          else 'text'
        end,
        'body', m.body,
        'media_url', case
          when m.direction = 'operator'
            and m.metadata #>> '{webchat_attachment,type}' = 'document'
            and m.metadata #>> '{webchat_attachment,mime}' = 'application/pdf'
            and m.metadata #>> '{webchat_attachment,url}' like 'https://%'
          then m.metadata #>> '{webchat_attachment,url}'
          else null
        end,
        'media_mime', case
          when m.direction = 'operator'
            and m.metadata #>> '{webchat_attachment,type}' = 'document'
            and m.metadata #>> '{webchat_attachment,mime}' = 'application/pdf'
            and m.metadata #>> '{webchat_attachment,url}' like 'https://%'
          then 'application/pdf'
          else null
        end,
        'created_at', m.created_at,
        'sender_kind', case
          when m.direction = 'operator' and m.sent_by_user_id is null then 'ai'
          when m.direction = 'operator' then 'human'
          else null
        end
      )
      order by m.created_at asc
    ),
    '[]'::jsonb
  )
  from public.webchat_messages m
  join public.webchat_visitor_sessions s
    on s.id = m.visitor_session_id
  where m.organization_id = p_organization_id
    and m.source_conversation_id = p_source_conversation_id
    and m.visitor_session_id = p_visitor_session_id
    and s.organization_id = p_organization_id
    and s.source_conversation_id = p_source_conversation_id;
$$;

revoke execute on function public.fn_ler_mensagens_webchat_operador(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_ler_mensagens_webchat_operador(uuid, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';

