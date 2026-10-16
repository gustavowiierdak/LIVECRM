-- manifest: Acompanha O.S. do IXC por atendimento, sem reabrir conversas e com confirmação do cliente antes do encerramento.
create table if not exists public.ixc_service_order_watches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  service_revision bigint not null check (service_revision > 0),
  service_boundary jsonb not null check (jsonb_typeof(service_boundary) = 'object'),
  customer_id text not null check (customer_id ~ '^[0-9]{1,20}$'),
  contract_id text not null check (contract_id ~ '^[0-9]{1,20}$'),
  order_id text not null check (order_id ~ '^[0-9]{1,20}$'),
  state text not null default 'active' check (state in ('active','awaiting_confirmation','resolved','stopped')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  next_poll_at timestamptz not null default now(),
  last_notice_id uuid,
  notice_state text not null default 'none' check (notice_state in ('none','attempting','sent','review')),
  inbox_item_id uuid references public.agent_inbox_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, conversation_id, service_revision, order_id)
);
create index if not exists ixc_os_watch_due on public.ixc_service_order_watches (next_poll_at)
  where state in ('active','awaiting_confirmation');
alter table public.ixc_service_order_watches enable row level security;
-- Dados operacionais internos: visibilidade humana pela central, não via PostgREST livre.
revoke all on public.ixc_service_order_watches from public, anon, authenticated;
grant all on public.ixc_service_order_watches to service_role;

create or replace function public.fn_ixc_os_watch_scope() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.conversations c
    join public.contacts p on p.id = c.contact_id and p.organization_id = c.organization_id
    where c.id = new.conversation_id and c.organization_id = new.organization_id
      and c.contact_id = new.contact_id
  ) or new.service_boundary->>'organization_id' is distinct from new.organization_id::text
    or new.service_boundary->>'conversation_id' is distinct from new.conversation_id::text
    or new.service_boundary->>'contact_id' is distinct from new.contact_id::text
    or new.service_boundary->>'service_revision' is distinct from new.service_revision::text then
    raise exception 'ixc_watch_scope_mismatch' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.fn_ixc_os_watch_scope() from public, anon, authenticated;
grant execute on function public.fn_ixc_os_watch_scope() to service_role;
drop trigger if exists trg_ixc_os_watch_scope on public.ixc_service_order_watches;
create trigger trg_ixc_os_watch_scope before insert or update on public.ixc_service_order_watches
for each row execute function public.fn_ixc_os_watch_scope();
notify pgrst, 'reload schema';

