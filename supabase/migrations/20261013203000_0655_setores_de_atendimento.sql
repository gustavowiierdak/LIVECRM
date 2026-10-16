-- manifest: Setores e membros de atendimento, fila por setor e encaminhamento humano com escopo de organização.
create table if not exists public.atendimento_setores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z][a-z0-9-]{0,59}$'),
  nome text not null check (length(trim(nome)) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (organization_id, slug), unique (organization_id, id)
);
create table if not exists public.atendimento_setor_membros (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  setor_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (organization_id, setor_id, user_id),
  foreign key (organization_id, setor_id) references public.atendimento_setores(organization_id,id) on delete cascade
);
create index if not exists atendimento_setor_membros_usuario on public.atendimento_setor_membros(organization_id,user_id);
alter table public.atendimento_setores enable row level security;
alter table public.atendimento_setor_membros enable row level security;
drop policy if exists tenant_isolation_atendimento_setores_all on public.atendimento_setores;
create policy tenant_isolation_atendimento_setores_all on public.atendimento_setores for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists tenant_isolation_atendimento_setor_membros_all on public.atendimento_setor_membros;
create policy tenant_isolation_atendimento_setor_membros_all on public.atendimento_setor_membros for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));
revoke all on public.atendimento_setores, public.atendimento_setor_membros from anon, authenticated;
grant select on public.atendimento_setores, public.atendimento_setor_membros to authenticated;
grant all on public.atendimento_setores, public.atendimento_setor_membros to service_role;

alter table public.conversations add column if not exists atendimento_setor_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='conversations_setor_da_organizacao_fk') then
    alter table public.conversations add constraint conversations_setor_da_organizacao_fk
      foreign key (organization_id,atendimento_setor_id) references public.atendimento_setores(organization_id,id);
  end if;
end $$;
create index if not exists conversations_fila_setor on public.conversations(organization_id,atendimento_setor_id,awaiting_since)
  where assigned_to_user_id is null;

create or replace function public.fn_atendimento_criar_setores_padrao(p_org uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is not null and not public.fn_session_mfa_proven() then raise insufficient_privilege; end if;
  if auth.uid() is not null and not public.fn_role_at_least(p_org,'manager') then raise insufficient_privilege; end if;
  insert into public.atendimento_setores(organization_id,slug,nome)
  select p_org,slug,nome from (values
    ('comercial','Comercial'),('agendamento','Agendamento'),('suporte-tecnico','Suporte Técnico'),
    ('cobranca','Cobrança'),('sac','SAC')) as s(slug,nome)
  on conflict (organization_id,slug) do nothing;
  -- Liga também as conversas web anteriores à ativação, sem trocar um setor escolhido por humano.
  update public.conversations c set atendimento_setor_id=s.id
  from public.atendimento_setores s where c.organization_id=p_org and s.organization_id=p_org
    and c.channel='webchat' and c.atendimento_setor_id is null
    and s.slug=(select case v.sector when 'suporte' then 'suporte-tecnico' when 'financeiro' then 'cobranca'
      when 'cancelamento' then 'sac' else v.sector end from public.webchat_visitor_sessions v
      where v.organization_id=p_org and v.source_conversation_id=c.id order by v.created_at desc limit 1);
end $$;
revoke all on function public.fn_atendimento_criar_setores_padrao(uuid) from public,anon;
grant execute on function public.fn_atendimento_criar_setores_padrao(uuid) to authenticated,service_role;

create or replace function public.fn_atendimento_salvar_membros(p_org uuid,p_setor uuid,p_users uuid[])
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c record;
begin
  if auth.uid() is not null and not public.fn_session_mfa_proven() then raise insufficient_privilege; end if;
  if auth.uid() is not null and not public.fn_role_at_least(p_org,'manager') then raise insufficient_privilege; end if;
  perform 1 from public.atendimento_setores where organization_id=p_org and id=p_setor for update;
  if not found then raise exception 'setor_inexistente'; end if;
  if p_users is null or cardinality(p_users)>500 or exists (
    select 1 from unnest(p_users) u where not exists (select 1 from public.user_organizations m
      where m.organization_id=p_org and m.user_id=u and m.revoked_at is null and m.role in ('agent','manager','admin'))
  ) then raise exception 'membro_invalido'; end if;
  delete from public.atendimento_setor_membros where organization_id=p_org and setor_id=p_setor;
  insert into public.atendimento_setor_membros(organization_id,setor_id,user_id)
    select distinct p_org,p_setor,u from unnest(p_users) u;
  for c in select id from public.conversations where organization_id=p_org and atendimento_setor_id=p_setor
    and assigned_to_user_id is null and status in ('open','pending','ai_handling') loop
    perform public.fn_request_channel_routing(p_org,c.id);
  end loop;
end $$;
revoke all on function public.fn_atendimento_salvar_membros(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.fn_atendimento_salvar_membros(uuid,uuid,uuid[]) to authenticated,service_role;

-- Antes da primeira mensagem: o assunto escolhido já é um destino real de atendimento.
create or replace function public.fn_webchat_vincular_setor() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.conversations c set atendimento_setor_id=s.id from public.atendimento_setores s
    where c.organization_id=new.organization_id and c.id=new.source_conversation_id
      and c.channel='webchat' and c.atendimento_setor_id is null and s.organization_id=new.organization_id
      and s.slug=case new.sector when 'suporte' then 'suporte-tecnico' when 'financeiro' then 'cobranca'
        when 'cancelamento' then 'sac' else new.sector end;
  return new;
end $$;
revoke all on function public.fn_webchat_vincular_setor() from public,anon,authenticated;
drop trigger if exists trg_webchat_vincular_setor on public.webchat_visitor_sessions;
create trigger trg_webchat_vincular_setor after insert on public.webchat_visitor_sessions
  for each row execute function public.fn_webchat_vincular_setor();

-- Defesa contra mudança de vínculo entre a seleção do worker e a atribuição.
create or replace function public.fn_atendimento_validar_destino() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.atendimento_setor_id is not null and new.assigned_to_user_id is not null
    and (tg_op='INSERT' or new.assigned_to_user_id is distinct from old.assigned_to_user_id)
    and not exists (select 1 from public.atendimento_setor_membros m join public.user_organizations u
      on u.organization_id=m.organization_id and u.user_id=m.user_id and u.revoked_at is null
      and u.role in ('agent','manager','admin') where m.organization_id=new.organization_id
      and m.setor_id=new.atendimento_setor_id and m.user_id=new.assigned_to_user_id)
    and not (auth.uid() is not null and public.fn_role_at_least(new.organization_id,'manager'))
  then raise exception 'O atendente não está vinculado ao setor desta conversa.' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.fn_atendimento_validar_destino() from public,anon,authenticated;
drop trigger if exists trg_atendimento_validar_destino on public.conversations;
create trigger trg_atendimento_validar_destino before insert or update of assigned_to_user_id on public.conversations
  for each row execute function public.fn_atendimento_validar_destino();

create or replace function public.fn_atendimento_transferir_setor(p_org uuid,p_conversa uuid,p_setor uuid,p_motivo text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.conversations; v_nome text; v_contact uuid;
begin
  if auth.uid() is not null and not public.fn_role_at_least(p_org,'agent') then raise insufficient_privilege; end if;
  if auth.uid() is not null and not public.fn_session_mfa_proven() then raise insufficient_privilege; end if;
  select contact_id into v_contact from public.conversations where organization_id=p_org and id=p_conversa;
  if not found then raise exception 'conversa_inexistente'; end if;
  perform public.fn_service_lock(p_org,v_contact);
  select * into c from public.conversations where organization_id=p_org and id=p_conversa for update;
  if not found then raise exception 'conversa_inexistente'; end if;
  if auth.uid() is not null and not public.fn_can_view_conversation(p_org,c.assigned_to_user_id) then raise insufficient_privilege; end if;
  if c.status in ('closed','resolved','archived') then raise exception 'atendimento_encerrado'; end if;
  select nome into v_nome from public.atendimento_setores where organization_id=p_org and id=p_setor;
  if not found then raise exception 'setor_inexistente'; end if;
  update public.conversations set atendimento_setor_id=p_setor,status='pending',assigned_to_user_id=null,
    assigned_to_user_name=null,assignee_kind=null,assigned_at=null,bot_silenced_until='infinity',
    active_ai_agent_id=null,active_intent=null,active_agent_set_at=null,last_handoff_at=now(),
    last_handoff_reason='requested_human' where organization_id=p_org and id=p_conversa;
  insert into public.conversation_assignment_events(organization_id,conversation_id,from_user_id,to_user_id,reason,changed_by)
    values(p_org,p_conversa,c.assigned_to_user_id,null,'transfer',auth.uid());
  perform public.emit_event('conversation.transferred','conversation',p_conversa,
    jsonb_build_object('atendimento_setor_id',p_setor,'setor',v_nome,'motivo',left(p_motivo,500)), '{}'::jsonb,p_org);
  perform public.fn_request_channel_routing(p_org,p_conversa);
  return c.contact_id;
end $$;
revoke all on function public.fn_atendimento_transferir_setor(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.fn_atendimento_transferir_setor(uuid,uuid,uuid,text) to authenticated,service_role;

-- Revalida o setor no ponto da atribuição, inclusive após troca de vínculos.
create or replace function public.fn_channel_routing_claim(p_org uuid,p_conversation uuid,p_channel uuid,p_user uuid,p_schedule jsonb default null,p_reason text default 'routing')
returns text language plpgsql security definer set search_path=public as $$
declare c public.conversations; pre_contact uuid; member_id uuid; v_policy_id uuid; availability public.attendant_availability; current_load integer;
begin
 if p_reason not in('routing','handoff') then raise exception 'routing_reason_invalid' using errcode='22023';end if;
 select contact_id into pre_contact from public.conversations where organization_id=p_org and id=p_conversation;
 if not found then return 'conversation_changed';end if;
 perform public.fn_service_lock(p_org,pre_contact);
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_user::text,228));
 -- Task9: o trigger de status do canal toca conversas; ordem comum channel -> conversation.
 perform 1 from public.channel_sessions where organization_id=p_org and id=p_channel for share;
 if not found then return 'conversation_changed';end if;
 select * into c from public.conversations where organization_id=p_org and id=p_conversation for no key update;
 if not found or c.contact_id is distinct from pre_contact or c.channel_session_id is distinct from p_channel
  or c.status not in('open','pending','claimed','ai_handling') then return 'conversation_changed';end if;
 if c.assigned_to_user_id is not null then return 'already_assigned';end if;
 select id into member_id from public.user_organizations where organization_id=p_org and user_id=p_user
  and revoked_at is null and role in('agent','manager','admin') for share;
 if not found then return 'candidate_revoked';end if;
 select id into v_policy_id from public.channel_routing_policies where organization_id=p_org and channel_session_id=p_channel;
 if found and not exists(select 1 from public.channel_routing_responsibles r where r.organization_id=p_org and r.policy_id=v_policy_id and r.user_id=p_user)
 then return 'candidate_not_allowed';end if;
 if c.atendimento_setor_id is not null then
   perform 1 from public.atendimento_setor_membros where organization_id=p_org
     and setor_id=c.atendimento_setor_id and user_id=p_user for share;
   if not found then return 'candidate_not_allowed';end if;
 end if;
 select * into availability from public.attendant_availability where organization_id=p_org and user_id=p_user for share;
 if not found or not availability.is_available or (p_schedule is not null and availability.schedule is distinct from p_schedule)
 then return 'capacity_changed';end if;
 select count(*) into current_load from public.conversations where organization_id=p_org and assigned_to_user_id=p_user and status in('open','pending','claimed','ai_handling');
 if current_load>=availability.capacity then return 'capacity_changed';end if;
 perform public.fn_conversation_assign(p_org,p_conversation,p_user,p_reason,null,true);
 return 'assigned';
end;
$$;
revoke all on function public.fn_channel_routing_claim(uuid,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.fn_channel_routing_claim(uuid,uuid,uuid,uuid,jsonb,text) to service_role;

notify pgrst, 'reload schema';
