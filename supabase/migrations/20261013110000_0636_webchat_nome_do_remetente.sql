-- manifest: O portal web identifica o autor de cada mensagem pelo nome do atendente ou agente da mesma organização, sem expor e-mail ou IDs internos.

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
          'sender_kind', case when m.direction = 'operator'
            then case when m.sent_by_user_id is not null then 'human'
              when m.metadata ? 'ai_actor_id' then 'ai' else null end
            else null end,
          'sender_name', case when m.direction = 'operator'
            then case when m.sent_by_user_id is not null
              then nullif(btrim(u.raw_user_meta_data->>'full_name'), '')
              else nullif(btrim(a.name), '') end
            else null end,
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
      left join public.user_organizations membership
        on membership.organization_id = m.organization_id
        and membership.user_id = m.sent_by_user_id
      left join auth.users u on u.id = membership.user_id
      left join public.ai_agents a
        on a.organization_id = m.organization_id
        and a.id::text = m.metadata->>'ai_actor_id'
        and m.sent_by_user_id is null
        and m.direction = 'operator'
      where m.visitor_session_id = s.id
        and m.organization_id = s.organization_id
        and m.source_conversation_id = s.source_conversation_id
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

notify pgrst, 'reload schema';
