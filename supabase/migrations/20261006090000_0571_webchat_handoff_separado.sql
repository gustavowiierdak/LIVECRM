-- manifest: Canal webchat separado e fechado por padrão, com handoff opaco de uso único, mensagens isoladas e RPCs atômicas para nunca expor o histórico ou a identidade do WhatsApp ao visitante.

create table if not exists public.webchat_channel_configs (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  public_id uuid not null default gen_random_uuid(),
  channel_session_id uuid references public.channel_sessions(id) on delete restrict,
  allowed_sectors text[] not null default '{}', allowed_origins text[] not null default '{}',
  handoff_ttl_seconds integer not null default 900 check (handoff_ttl_seconds between 60 and 3600),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint webchat_channel_configs_sectors_check check (allowed_sectors <@ array['suporte', 'financeiro', 'cancelamento']::text[]),
  constraint webchat_channel_configs_enabled_requires_allowlist_check check (not enabled or (cardinality(allowed_sectors) > 0 and cardinality(allowed_origins) > 0))
);
alter table public.webchat_channel_configs
  add column if not exists public_id uuid not null default gen_random_uuid(),
  add column if not exists channel_session_id uuid references public.channel_sessions(id) on delete restrict;
create unique index if not exists webchat_channel_configs_public_id_unique on public.webchat_channel_configs(public_id);
alter table public.channel_sessions drop constraint if exists channel_sessions_provider_check;
alter table public.channel_sessions add constraint channel_sessions_provider_check
  check (provider in ('waha', 'meta_cloud', 'zernio', 'zernio_social', 'wacalls', 'datafy', 'webchat'));
alter table public.channel_sessions drop constraint if exists channel_sessions_provider_ref_check;
alter table public.channel_sessions add constraint channel_sessions_provider_ref_check check (
  (provider = 'waha' and waha_session_name is not null) or
  (provider = 'meta_cloud' and meta_phone_number_id is not null) or
  (provider in ('zernio', 'zernio_social') and zernio_account_id is not null) or
  (provider = 'wacalls' and wacalls_session_id is not null) or
  (provider = 'datafy' and datafy_phone_number_id is not null) or
  provider = 'webchat'
);
alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations add constraint conversations_channel_check
  check (channel in ('whatsapp', 'instagram', 'facebook', 'webchat'));
create table if not exists public.webchat_handoffs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  source_conversation_id uuid not null references public.conversations(id) on delete restrict, source_channel_session_id uuid not null references public.channel_sessions(id) on delete restrict, contact_id uuid not null references public.contacts(id) on delete restrict,
  sector text not null check (sector in ('suporte', 'financeiro', 'cancelamento')),
  token_digest text not null unique check (token_digest ~ '^[0-9a-f]{64}$'), expires_at timestamptz not null,
  consumed_at timestamptz, revoked_at timestamptz, issued_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), check (expires_at > created_at)
);
create index if not exists webchat_handoffs_claim on public.webchat_handoffs(token_digest, expires_at) where consumed_at is null and revoked_at is null;
create table if not exists public.webchat_visitor_sessions (
  id uuid primary key default gen_random_uuid(), handoff_id uuid unique references public.webchat_handoffs(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade, contact_id uuid not null references public.contacts(id) on delete restrict,
  source_conversation_id uuid not null references public.conversations(id) on delete restrict,
  sector text not null check (sector in ('suporte', 'financeiro', 'cancelamento')),
  session_digest text not null unique check (session_digest ~ '^[0-9a-f]{64}$'), csrf_digest text not null check (csrf_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists webchat_visitor_sessions_active on public.webchat_visitor_sessions(session_digest, expires_at) where revoked_at is null;
alter table public.webchat_visitor_sessions alter column handoff_id drop not null;
create table if not exists public.webchat_messages (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  visitor_session_id uuid not null references public.webchat_visitor_sessions(id) on delete cascade,
  source_conversation_id uuid not null references public.conversations(id) on delete restrict,
  direction text not null check (direction in ('visitor', 'operator')), body text not null check (char_length(trim(body)) between 1 and 4000),
  idempotency_key uuid not null, sent_by_user_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  constraint webchat_messages_idempotent unique (visitor_session_id, direction, idempotency_key)
);
create index if not exists webchat_messages_operator_timeline on public.webchat_messages(organization_id, source_conversation_id, visitor_session_id, created_at);
alter table public.webchat_channel_configs enable row level security;
alter table public.webchat_handoffs enable row level security;
alter table public.webchat_visitor_sessions enable row level security;
alter table public.webchat_messages enable row level security;
revoke all on public.webchat_channel_configs, public.webchat_handoffs, public.webchat_visitor_sessions, public.webchat_messages from anon, authenticated;

-- O token puro nunca entra no banco. Consumo e criação de sessão são atômicos.
create or replace function public.fn_emitir_webchat_handoff(p_organization_id uuid, p_source_conversation_id uuid, p_sector text, p_token_digest text, p_issued_by uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_config public.webchat_channel_configs%rowtype; v_conversation public.conversations%rowtype; v_handoff public.webchat_handoffs%rowtype;
begin
  select * into v_config from public.webchat_channel_configs where organization_id = p_organization_id and enabled = true for update;
  if not found or not (p_sector = any(v_config.allowed_sectors)) then return jsonb_build_object('ok', false, 'reason', 'webchat_disabled'); end if;
  select * into v_conversation from public.conversations where id = p_source_conversation_id and organization_id = p_organization_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'conversation_not_found'); end if;
  if not exists (select 1 from public.contacts where id = v_conversation.contact_id and organization_id = p_organization_id and is_anonymized = false)
    then return jsonb_build_object('ok', false, 'reason', 'contact_unavailable'); end if;
  insert into public.webchat_handoffs (organization_id, source_conversation_id, source_channel_session_id, contact_id, sector, token_digest, expires_at, issued_by)
  values (p_organization_id, v_conversation.id, v_conversation.channel_session_id, v_conversation.contact_id, p_sector, p_token_digest, now() + make_interval(secs => v_config.handoff_ttl_seconds), p_issued_by) returning * into v_handoff;
  return jsonb_build_object('ok', true, 'handoff_id', v_handoff.id, 'expires_at', v_handoff.expires_at);
end; $$;
create or replace function public.fn_consumir_webchat_handoff(p_token_digest text, p_session_digest text, p_csrf_digest text, p_origin text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_handoff public.webchat_handoffs%rowtype; v_session public.webchat_visitor_sessions%rowtype;
begin
  update public.webchat_handoffs h set consumed_at = now() from public.webchat_channel_configs c
  where h.token_digest = p_token_digest and h.organization_id = c.organization_id and c.enabled = true and p_origin = any(c.allowed_origins)
    and h.consumed_at is null and h.revoked_at is null and h.expires_at > now() returning h.* into v_handoff;
  if not found then return jsonb_build_object('ok', false); end if;
  insert into public.webchat_visitor_sessions (handoff_id, organization_id, contact_id, source_conversation_id, sector, session_digest, csrf_digest, expires_at)
  values (v_handoff.id, v_handoff.organization_id, v_handoff.contact_id, v_handoff.source_conversation_id, v_handoff.sector, p_session_digest, p_csrf_digest, now() + interval '8 hours') returning * into v_session;
  return jsonb_build_object('ok', true, 'sector', v_session.sector, 'expires_at', v_session.expires_at);
end; $$;
create or replace function public.fn_webchat_sessao_visitante(p_session_digest text, p_origin text) returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_build_object('ok', true, 'sector', s.sector, 'expires_at', s.expires_at, 'public_id', c.public_id), '{"ok":false}'::jsonb) from public.webchat_visitor_sessions s join public.webchat_channel_configs c on c.organization_id = s.organization_id where s.session_digest = p_session_digest and s.expires_at > now() and s.revoked_at is null and c.enabled = true and p_origin = any(c.allowed_origins) limit 1;
$$;
create or replace function public.fn_ler_mensagens_webchat_visitante(p_session_digest text, p_origin text) returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'direction', m.direction, 'body', m.body, 'created_at', m.created_at) order by m.created_at asc) from public.webchat_messages m where m.visitor_session_id = s.id), '[]'::jsonb)
  from public.webchat_visitor_sessions s join public.webchat_channel_configs c on c.organization_id = s.organization_id
  where s.session_digest = p_session_digest and s.expires_at > now() and s.revoked_at is null and c.enabled = true and p_origin = any(c.allowed_origins) limit 1;
$$;
create or replace function public.fn_registrar_mensagem_webchat_visitante(p_session_digest text, p_csrf_digest text, p_origin text, p_body text, p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_session public.webchat_visitor_sessions%rowtype; v_message public.webchat_messages%rowtype;
begin
  select s.* into v_session from public.webchat_visitor_sessions s join public.webchat_channel_configs c on c.organization_id = s.organization_id join public.contacts ct on ct.id = s.contact_id and ct.organization_id = s.organization_id where s.session_digest = p_session_digest and s.csrf_digest = p_csrf_digest and s.expires_at > now() and s.revoked_at is null and c.enabled = true and p_origin = any(c.allowed_origins) and ct.is_blocked = false and ct.is_anonymized = false for update of s;
  if not found then return jsonb_build_object('ok', false); end if;
  insert into public.webchat_messages (organization_id, visitor_session_id, source_conversation_id, direction, body, idempotency_key) values (v_session.organization_id, v_session.id, v_session.source_conversation_id, 'visitor', trim(p_body), p_idempotency_key) on conflict (visitor_session_id, direction, idempotency_key) do nothing returning * into v_message;
  if found then
    perform public.fn_mark_conversation_message(v_session.source_conversation_id, 'inbound', left(v_message.body, 160), v_message.created_at);
    update public.conversations set status_changed_at = now(), status = 'open', updated_at = now()
      where id = v_session.source_conversation_id and organization_id = v_session.organization_id
        and status in ('closed', 'resolved', 'archived');
  else
    select * into v_message from public.webchat_messages where visitor_session_id = v_session.id and direction = 'visitor' and idempotency_key = p_idempotency_key;
  end if;
  return jsonb_build_object('ok', true, 'message', jsonb_build_object('id', v_message.id, 'direction', v_message.direction, 'body', v_message.body, 'created_at', v_message.created_at));
end; $$;
create or replace function public.fn_ler_mensagens_webchat_operador(p_organization_id uuid, p_source_conversation_id uuid, p_visitor_session_id uuid) returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'direction', m.direction, 'body', m.body, 'created_at', m.created_at) order by m.created_at asc), '[]'::jsonb) from public.webchat_messages m join public.webchat_visitor_sessions s on s.id = m.visitor_session_id where m.organization_id = p_organization_id and m.source_conversation_id = p_source_conversation_id and m.visitor_session_id = p_visitor_session_id and s.organization_id = p_organization_id and s.source_conversation_id = p_source_conversation_id;
$$;
create or replace function public.fn_enviar_mensagem_webchat_operador(p_organization_id uuid, p_source_conversation_id uuid, p_visitor_session_id uuid, p_body text, p_idempotency_key uuid, p_sent_by_user_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_session public.webchat_visitor_sessions%rowtype; v_message public.webchat_messages%rowtype;
begin
  select s.* into v_session from public.webchat_visitor_sessions s join public.webchat_channel_configs c on c.organization_id = s.organization_id where s.id = p_visitor_session_id and s.organization_id = p_organization_id and s.source_conversation_id = p_source_conversation_id and s.expires_at > now() and s.revoked_at is null and c.enabled = true for update of s;
  if not found then return jsonb_build_object('ok', false); end if;
  insert into public.webchat_messages (organization_id, visitor_session_id, source_conversation_id, direction, body, idempotency_key, sent_by_user_id) values (p_organization_id, v_session.id, p_source_conversation_id, 'operator', trim(p_body), p_idempotency_key, p_sent_by_user_id) on conflict (visitor_session_id, direction, idempotency_key) do nothing returning * into v_message;
  if found then
    perform public.fn_mark_conversation_message(p_source_conversation_id, 'outbound', left(v_message.body, 160), v_message.created_at);
  else
    select * into v_message from public.webchat_messages where visitor_session_id = v_session.id and direction = 'operator' and idempotency_key = p_idempotency_key;
  end if;
  return jsonb_build_object('ok', true, 'message', jsonb_build_object('id', v_message.id, 'direction', v_message.direction, 'body', v_message.body, 'created_at', v_message.created_at));
end; $$;
create or replace function public.fn_listar_sessoes_webchat_operador(p_organization_id uuid, p_source_conversation_id uuid) returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'sector', s.sector, 'expires_at', s.expires_at, 'active', c.enabled and s.expires_at > now() and s.revoked_at is null) order by s.created_at desc), '[]'::jsonb)
  from public.webchat_visitor_sessions s join public.webchat_channel_configs c on c.organization_id = s.organization_id
  where s.organization_id = p_organization_id and s.source_conversation_id = p_source_conversation_id;
$$;
revoke all on function public.fn_emitir_webchat_handoff(uuid, uuid, text, text, uuid), public.fn_consumir_webchat_handoff(text, text, text, text), public.fn_webchat_sessao_visitante(text, text), public.fn_ler_mensagens_webchat_visitante(text, text), public.fn_registrar_mensagem_webchat_visitante(text, text, text, text, uuid), public.fn_ler_mensagens_webchat_operador(uuid, uuid, uuid), public.fn_enviar_mensagem_webchat_operador(uuid, uuid, uuid, text, uuid, uuid), public.fn_listar_sessoes_webchat_operador(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_emitir_webchat_handoff(uuid, uuid, text, text, uuid), public.fn_consumir_webchat_handoff(text, text, text, text), public.fn_webchat_sessao_visitante(text, text), public.fn_ler_mensagens_webchat_visitante(text, text), public.fn_registrar_mensagem_webchat_visitante(text, text, text, text, uuid), public.fn_ler_mensagens_webchat_operador(uuid, uuid, uuid), public.fn_enviar_mensagem_webchat_operador(uuid, uuid, uuid, text, uuid, uuid), public.fn_listar_sessoes_webchat_operador(uuid, uuid) to service_role;

-- A virada de is_anonymized é compartilhada pelos dois caminhos de LGPD.
-- Preserva o fato e as datas do atendimento, mas revoga acessos e redige texto livre.
create or replace function public.fn_webchat_redigir_contato() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.webchat_messages m set body = '[mensagem anonimizada]'
    from public.webchat_visitor_sessions s
   where m.visitor_session_id = s.id and s.organization_id = new.organization_id
     and s.contact_id = new.id and m.body <> '[mensagem anonimizada]';
  update public.webchat_visitor_sessions set revoked_at = now()
   where organization_id = new.organization_id and contact_id = new.id and revoked_at is null;
  update public.webchat_handoffs set revoked_at = now()
   where organization_id = new.organization_id and contact_id = new.id and revoked_at is null;
  return new;
end; $$;
revoke all on function public.fn_webchat_redigir_contato() from public, anon, authenticated;
grant execute on function public.fn_webchat_redigir_contato() to service_role;
drop trigger if exists trg_webchat_redigir_contato on public.contacts;
create trigger trg_webchat_redigir_contato after update of is_anonymized on public.contacts
  for each row when (new.is_anonymized = true and old.is_anonymized is distinct from true)
  execute function public.fn_webchat_redigir_contato();

-- Entrada autônoma: o link público identifica a CONFIGURAÇÃO, nunca uma org
-- enviada no corpo. O primeiro contato cria contato, conversa e mensagem
-- atômicos; não há estado em que o visitante acha que chamou sem a Inbox ver.
create or replace function public.fn_iniciar_webchat_publico(
  p_public_id uuid, p_origin text, p_name text, p_sector text, p_body text,
  p_session_digest text, p_csrf_digest text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_config public.webchat_channel_configs%rowtype;
  v_channel_id uuid; v_contact_id uuid; v_conversation_id uuid;
  v_visitor_id uuid; v_message_id uuid; v_created_at timestamptz;
begin
  select * into v_config from public.webchat_channel_configs
    where public_id = p_public_id and enabled = true and p_origin = any(allowed_origins)
      and p_sector = any(allowed_sectors) for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if char_length(trim(p_name)) not between 2 and 80 or
     char_length(trim(p_body)) not between 1 and 4000 or
     p_session_digest !~ '^[0-9a-f]{64}$' or p_csrf_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false);
  end if;
  v_channel_id := v_config.channel_session_id;
  if v_channel_id is null then
    insert into public.channel_sessions
      (organization_id, provider, waha_session_name, webhook_secret_encrypted,
       status, display_name)
    values (v_config.organization_id, 'webchat', null, extensions.gen_random_bytes(32),
            'WORKING', 'Atendimento web') returning id into v_channel_id;
    update public.webchat_channel_configs set channel_session_id = v_channel_id,
      updated_at = now() where organization_id = v_config.organization_id;
  end if;
  insert into public.contacts
    (organization_id, name, display_name, source, force_human)
  values (v_config.organization_id, trim(p_name), trim(p_name), 'webchat', true)
    returning id into v_contact_id;
  insert into public.conversations
    (organization_id, contact_id, channel_session_id, channel, status)
  values (v_config.organization_id, v_contact_id, v_channel_id, 'webchat', 'open')
    returning id into v_conversation_id;
  insert into public.webchat_visitor_sessions
    (organization_id, contact_id, source_conversation_id, sector,
     session_digest, csrf_digest, expires_at)
  values (v_config.organization_id, v_contact_id, v_conversation_id, p_sector,
          p_session_digest, p_csrf_digest, now() + interval '7 days')
    returning id into v_visitor_id;
  insert into public.webchat_messages
    (organization_id, visitor_session_id, source_conversation_id,
     direction, body, idempotency_key)
  values (v_config.organization_id, v_visitor_id, v_conversation_id,
          'visitor', trim(p_body), p_idempotency_key)
    returning id, created_at into v_message_id, v_created_at;
  perform public.fn_mark_conversation_message(v_conversation_id, 'inbound', left(trim(p_body), 160), v_created_at);
  return jsonb_build_object('ok', true, 'sector', p_sector,
    'organization_id', v_config.organization_id, 'conversation_id', v_conversation_id,
    'expires_at', now() + interval '7 days',
    'message', jsonb_build_object('id', v_message_id, 'direction', 'visitor',
      'body', trim(p_body), 'created_at', v_created_at));
end; $$;
revoke execute on function public.fn_iniciar_webchat_publico(uuid, text, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.fn_iniciar_webchat_publico(uuid, text, text, text, text, text, text, uuid) to service_role;
