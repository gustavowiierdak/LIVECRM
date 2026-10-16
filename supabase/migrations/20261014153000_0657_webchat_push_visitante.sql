-- manifest: Inscricoes Web Push do visitante ficam presas a sessao opaca e respostas da IA ou da equipe emitem um comando duravel, sem texto privado, para o worker avisar o celular.

create unique index if not exists webchat_visitor_sessions_id_org_unique
  on public.webchat_visitor_sessions (id, organization_id);
create table if not exists public.webchat_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  visitor_session_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webchat_push_session_org_fk foreign key (visitor_session_id, organization_id)
    references public.webchat_visitor_sessions(id, organization_id) on delete cascade
);
create index if not exists webchat_push_subscriptions_session_idx
  on public.webchat_push_subscriptions (organization_id, visitor_session_id);
alter table public.webchat_push_subscriptions enable row level security;
revoke all on public.webchat_push_subscriptions from public, anon, authenticated;
grant all on public.webchat_push_subscriptions to service_role;

create or replace function public.fn_webchat_resposta_para_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'operator' then
    insert into public.event_log (organization_id, event_type, entity_kind, entity_id, payload)
    values (new.organization_id, 'webchat.reply_created', 'webchat_message', new.id,
      jsonb_build_object('visitor_session_id', new.visitor_session_id));
  end if;
  return new;
end; $$;
revoke all on function public.fn_webchat_resposta_para_push() from public, anon, authenticated;
grant execute on function public.fn_webchat_resposta_para_push() to service_role;
drop trigger if exists trg_webchat_resposta_para_push on public.webchat_messages;
create trigger trg_webchat_resposta_para_push
  after insert on public.webchat_messages
  for each row execute function public.fn_webchat_resposta_para_push();
notify pgrst, 'reload schema';
