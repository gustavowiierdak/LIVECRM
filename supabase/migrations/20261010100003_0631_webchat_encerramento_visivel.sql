-- manifest: O fechamento da conversa web encerra a sessao publica, grava um aviso visivel no fio e impede que uma mensagem tardia reabra o atendimento.

alter table public.webchat_messages
  drop constraint if exists webchat_messages_direction_check;

alter table public.webchat_messages
  add constraint webchat_messages_direction_check
  check (direction in ('visitor', 'operator', 'system'));

-- A sessao continua legivel depois do fechamento para o cliente conservar o
-- historico. `active` governa somente novas escritas e a composicao da tela.
create or replace function public.fn_webchat_sessao_visitante(
  p_session_digest text,
  p_origin text
) returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    jsonb_build_object(
      'ok', true,
      'sector', s.sector,
      'expires_at', s.expires_at,
      'public_id', cfg.public_id,
      'active', conv.status not in ('closed', 'resolved', 'archived'),
      'closed_at', case
        when conv.status in ('closed', 'resolved', 'archived')
          then coalesce(conv.service_closed_at, conv.status_changed_at)
        else null
      end
    ),
    '{"ok":false}'::jsonb
  )
  from public.webchat_visitor_sessions s
  join public.webchat_channel_configs cfg
    on cfg.organization_id = s.organization_id
  join public.conversations conv
    on conv.id = s.source_conversation_id
   and conv.organization_id = s.organization_id
  where s.session_digest = p_session_digest
    and s.expires_at > now()
    and s.revoked_at is null
    and cfg.enabled = true
    and p_origin = any(cfg.allowed_origins)
  limit 1;
$$;

-- Uma mensagem do visitante so pertence ao episodio ainda aberto. Antes, esta
-- funcao reabria silenciosamente a conversa que o operador acabara de fechar.
create or replace function public.fn_registrar_mensagem_webchat_visitante(
  p_session_digest text,
  p_csrf_digest text,
  p_origin text,
  p_body text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.webchat_visitor_sessions%rowtype;
  v_message public.webchat_messages%rowtype;
begin
  select s.* into v_session
  from public.webchat_visitor_sessions s
  join public.webchat_channel_configs cfg
    on cfg.organization_id = s.organization_id
  join public.contacts ct
    on ct.id = s.contact_id
   and ct.organization_id = s.organization_id
  join public.conversations conv
    on conv.id = s.source_conversation_id
   and conv.organization_id = s.organization_id
  where s.session_digest = p_session_digest
    and s.csrf_digest = p_csrf_digest
    and s.expires_at > now()
    and s.revoked_at is null
    and cfg.enabled = true
    and p_origin = any(cfg.allowed_origins)
    and ct.is_blocked = false
    and ct.is_anonymized = false
    and conv.status not in ('closed', 'resolved', 'archived')
  for update of s;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'conversation_closed');
  end if;

  insert into public.webchat_messages (
    organization_id, visitor_session_id, source_conversation_id,
    direction, body, idempotency_key
  ) values (
    v_session.organization_id, v_session.id, v_session.source_conversation_id,
    'visitor', trim(p_body), p_idempotency_key
  )
  on conflict (visitor_session_id, direction, idempotency_key) do nothing
  returning * into v_message;

  if found then
    perform public.fn_mark_conversation_message(
      v_session.source_conversation_id,
      'inbound',
      left(v_message.body, 160),
      v_message.created_at
    );
  else
    select * into v_message
    from public.webchat_messages
    where visitor_session_id = v_session.id
      and direction = 'visitor'
      and idempotency_key = p_idempotency_key;
  end if;

  return jsonb_build_object(
    'ok', true,
    'message', jsonb_build_object(
      'id', v_message.id,
      'direction', v_message.direction,
      'body', v_message.body,
      'created_at', v_message.created_at
    )
  );
end;
$$;

-- A Inbox tambem deixa de escrever numa sessao encerrada. Nota interna segue
-- disponivel no painel porque nao usa esta RPC e nao chega ao cliente.
create or replace function public.fn_enviar_mensagem_webchat_operador(
  p_organization_id uuid,
  p_source_conversation_id uuid,
  p_visitor_session_id uuid,
  p_body text,
  p_idempotency_key uuid,
  p_sent_by_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.webchat_visitor_sessions%rowtype;
  v_message public.webchat_messages%rowtype;
begin
  select s.* into v_session
  from public.webchat_visitor_sessions s
  join public.webchat_channel_configs cfg
    on cfg.organization_id = s.organization_id
  join public.conversations conv
    on conv.id = s.source_conversation_id
   and conv.organization_id = s.organization_id
  where s.id = p_visitor_session_id
    and s.organization_id = p_organization_id
    and s.source_conversation_id = p_source_conversation_id
    and s.expires_at > now()
    and s.revoked_at is null
    and cfg.enabled = true
    and conv.status not in ('closed', 'resolved', 'archived')
  for update of s;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'conversation_closed');
  end if;

  insert into public.webchat_messages (
    organization_id, visitor_session_id, source_conversation_id,
    direction, body, idempotency_key, sent_by_user_id
  ) values (
    p_organization_id, v_session.id, p_source_conversation_id,
    'operator', trim(p_body), p_idempotency_key, p_sent_by_user_id
  )
  on conflict (visitor_session_id, direction, idempotency_key) do nothing
  returning * into v_message;

  if found then
    perform public.fn_mark_conversation_message(
      p_source_conversation_id,
      'outbound',
      left(v_message.body, 160),
      v_message.created_at
    );
  else
    select * into v_message
    from public.webchat_messages
    where visitor_session_id = v_session.id
      and direction = 'operator'
      and idempotency_key = p_idempotency_key;
  end if;

  return jsonb_build_object(
    'ok', true,
    'message', jsonb_build_object(
      'id', v_message.id,
      'direction', v_message.direction,
      'body', v_message.body,
      'created_at', v_message.created_at
    )
  );
end;
$$;

create or replace function public.fn_listar_sessoes_webchat_operador(
  p_organization_id uuid,
  p_source_conversation_id uuid
) returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'sector', s.sector,
        'expires_at', s.expires_at,
        'active', cfg.enabled
          and s.expires_at > now()
          and s.revoked_at is null
          and conv.status not in ('closed', 'resolved', 'archived')
      ) order by s.created_at desc
    ),
    '[]'::jsonb
  )
  from public.webchat_visitor_sessions s
  join public.webchat_channel_configs cfg
    on cfg.organization_id = s.organization_id
  join public.conversations conv
    on conv.id = s.source_conversation_id
   and conv.organization_id = s.organization_id
  where s.organization_id = p_organization_id
    and s.source_conversation_id = p_source_conversation_id;
$$;

-- O fechamento e o aviso formam uma unica transacao: nunca existe o estado em
-- que a Inbox diz "fechada" e o visitante ainda nao recebeu o registro.
create or replace function public.fn_webchat_avisar_encerramento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.channel = 'webchat'
     and new.status in ('closed', 'resolved', 'archived')
     and old.status not in ('closed', 'resolved', 'archived') then
    insert into public.webchat_messages (
      organization_id, visitor_session_id, source_conversation_id,
      direction, body, idempotency_key
    )
    select
      s.organization_id,
      s.id,
      s.source_conversation_id,
      'system',
      'Atendimento encerrado pela equipe.',
      gen_random_uuid()
    from public.webchat_visitor_sessions s
    where s.organization_id = new.organization_id
      and s.source_conversation_id = new.id
      and s.revoked_at is null
      and s.expires_at > now();
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_webchat_avisar_encerramento()
  from public, anon, authenticated;
grant execute on function public.fn_webchat_avisar_encerramento()
  to service_role;

drop trigger if exists trg_webchat_avisar_encerramento on public.conversations;
create trigger trg_webchat_avisar_encerramento
after update of status on public.conversations
for each row
execute function public.fn_webchat_avisar_encerramento();

-- Corrige sessoes que ja estavam abertas no navegador quando esta versao foi
-- aplicada. Uma linha por sessao, somente quando ainda nao existe aviso.
insert into public.webchat_messages (
  organization_id, visitor_session_id, source_conversation_id,
  direction, body, idempotency_key
)
select
  s.organization_id,
  s.id,
  s.source_conversation_id,
  'system',
  'Atendimento encerrado pela equipe.',
  gen_random_uuid()
from public.webchat_visitor_sessions s
join public.conversations conv
  on conv.id = s.source_conversation_id
 and conv.organization_id = s.organization_id
where conv.channel = 'webchat'
  and conv.status in ('closed', 'resolved', 'archived')
  and s.revoked_at is null
  and s.expires_at > now()
  and not exists (
    select 1
    from public.webchat_messages m
    where m.visitor_session_id = s.id
      and m.direction = 'system'
      and m.body = 'Atendimento encerrado pela equipe.'
  );

revoke all on function
  public.fn_webchat_sessao_visitante(text, text),
  public.fn_registrar_mensagem_webchat_visitante(text, text, text, text, uuid),
  public.fn_enviar_mensagem_webchat_operador(uuid, uuid, uuid, text, uuid, uuid),
  public.fn_listar_sessoes_webchat_operador(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.fn_webchat_sessao_visitante(text, text),
  public.fn_registrar_mensagem_webchat_visitante(text, text, text, text, uuid),
  public.fn_enviar_mensagem_webchat_operador(uuid, uuid, uuid, text, uuid, uuid),
  public.fn_listar_sessoes_webchat_operador(uuid, uuid)
to service_role;

notify pgrst, 'reload schema';
