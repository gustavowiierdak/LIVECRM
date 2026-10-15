-- manifest: Protocolo persistente por atendimento e avisos automaticos de inicio, assuncao humana e encerramento em web e canais externos.
alter table public.conversations add column if not exists service_protocol text;
create sequence if not exists public.attendance_protocol_seq;
revoke all on sequence public.attendance_protocol_seq from public, anon, authenticated;
grant usage, select on sequence public.attendance_protocol_seq to service_role;

create or replace function public.fn_novo_protocolo_atendimento()
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare n text;
begin
  n := nextval('public.attendance_protocol_seq')::text;
  return to_char(clock_timestamp() at time zone 'UTC','YYYYMMDD') || '-' ||
    lpad(n,greatest(6,length(n)),'0');
end; $$;
revoke all on function public.fn_novo_protocolo_atendimento() from public,anon,authenticated;
grant execute on function public.fn_novo_protocolo_atendimento() to service_role;

-- Backfill silencioso: atualizar nunca dispara avisos retroativos a clientes.
update public.conversations set service_protocol=public.fn_novo_protocolo_atendimento()
 where service_protocol is null and not is_group;
create unique index if not exists conversations_service_protocol_unique
 on public.conversations(service_protocol) where service_protocol is not null;

-- Outbox de texto fixo: o evento aponta para este registro protegido, nunca
-- aceita texto fornecido por um chamador de emit_event.
create table if not exists public.attendance_notices (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 protocol text not null,
 kind text not null check (kind in ('iniciado','assumido','encerrado')),
 body text not null,
 assigned_to_user_id uuid,
 created_at timestamptz not null default now()
);
create index if not exists attendance_notices_conversation_idx
 on public.attendance_notices(organization_id,conversation_id,created_at);
create index if not exists attendance_notices_conversation_fk_idx on public.attendance_notices(conversation_id);
alter table public.attendance_notices enable row level security;
drop policy if exists tenant_isolation_attendance_notices_all on public.attendance_notices;
create policy tenant_isolation_attendance_notices_all on public.attendance_notices for select to authenticated
 using (organization_id in (select public.fn_user_org_ids()) and exists (
  select 1 from public.conversations c where c.id=conversation_id and c.organization_id=attendance_notices.organization_id));
revoke all on public.attendance_notices from public,anon,authenticated;
grant select on public.attendance_notices to authenticated;
grant all on public.attendance_notices to service_role;

create or replace function public.fn_atendimento_definir_protocolo()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.is_group then new.service_protocol := null; return new; end if;
  if tg_op='INSERT' then
    new.service_protocol := public.fn_novo_protocolo_atendimento();
  elsif old.service_protocol is null or
    (old.status in ('closed','resolved','archived') and new.status not in ('closed','resolved','archived')) then
    new.service_protocol := public.fn_novo_protocolo_atendimento();
  else
    new.service_protocol := old.service_protocol;
  end if;
  return new;
end; $$;
revoke all on function public.fn_atendimento_definir_protocolo() from public,anon,authenticated;
grant execute on function public.fn_atendimento_definir_protocolo() to service_role;
drop trigger if exists trg_atendimento_definir_protocolo on public.conversations;
create trigger trg_atendimento_definir_protocolo before insert or update of status,service_protocol
 on public.conversations for each row execute function public.fn_atendimento_definir_protocolo();

-- Uma unica redacao tanto no recibo web quanto no evento do transporte externo.
create or replace function public.fn_atendimento_texto_aviso(p_kind text,p_protocol text,p_name text default null)
returns text language sql immutable set search_path=public as $$
 select case p_kind
  when 'iniciado' then 'Seu atendimento foi iniciado. Protocolo: ' || p_protocol || '.'
  when 'assumido' then 'Seu atendimento agora está com ' || coalesce(nullif(trim(p_name),''),'um atendente da equipe') || '. Protocolo: ' || p_protocol || '.'
  when 'encerrado' then 'Seu atendimento foi encerrado. Protocolo: ' || p_protocol || '. Se precisar de mais ajuda, inicie um novo atendimento.'
 end;
$$;
revoke all on function public.fn_atendimento_texto_aviso(text,text,text) from public,anon,authenticated;
grant execute on function public.fn_atendimento_texto_aviso(text,text,text) to service_role;

-- Fechar por API, IA, MCP ou automacao passa por este MESMO registro.
create or replace function public.fn_atendimento_emitir_aviso()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare kind text; body text; notice_id uuid := gen_random_uuid();
begin
 if new.is_group or new.service_protocol is null then return new; end if;
 if tg_op='INSERT' then
   if new.status in ('closed','resolved','archived') then return new; end if;
   -- Uma conversa vazia/importada não iniciou atendimento com o cliente.
   if new.channel<>'webchat' and new.last_inbound_at is null and new.assigned_to_user_id is null then return new; end if;
   kind := 'iniciado';
 elsif old.status not in ('closed','resolved','archived') and new.status in ('closed','resolved','archived') then
   kind := 'encerrado';
 elsif old.status in ('closed','resolved','archived') and new.status not in ('closed','resolved','archived') then
   kind := 'iniciado';
 elsif new.channel<>'webchat' and old.last_inbound_at is null and new.last_inbound_at is not null
   and old.assigned_to_user_id is null and new.status not in ('closed','resolved','archived') then
   kind := 'iniciado';
 elsif new.status not in ('closed','resolved','archived') and new.assigned_to_user_id is not null
   and new.assigned_to_user_id is distinct from old.assigned_to_user_id then
   kind := 'assumido';
 else return new;
 end if;
 body := public.fn_atendimento_texto_aviso(kind,new.service_protocol,new.assigned_to_user_name);
 if new.channel='webchat' then
   -- A sessao inicial ainda nao existe no INSERT da conversa; seu proprio
   -- trigger de criacao, abaixo, registra o inicio na mesma transacao.
   insert into public.webchat_messages(organization_id,visitor_session_id,source_conversation_id,direction,body,idempotency_key,metadata,created_at)
   select s.organization_id,s.id,s.source_conversation_id,'system',body,
     md5(new.service_protocol || ':' || kind || ':' || coalesce(new.assigned_to_user_id::text,''))::uuid,
     jsonb_build_object('service_protocol',new.service_protocol,'attendance_notice',kind),clock_timestamp()
   from public.webchat_visitor_sessions s
   where s.organization_id=new.organization_id and s.source_conversation_id=new.id
     and s.revoked_at is null and s.expires_at>now()
   on conflict(visitor_session_id,direction,idempotency_key) do nothing;
 else
   insert into public.attendance_notices(id,organization_id,conversation_id,protocol,kind,body,assigned_to_user_id)
   values(notice_id,new.organization_id,new.id,new.service_protocol,kind,body,new.assigned_to_user_id);
   perform public.emit_event(
     p_organization_id=>new.organization_id,p_event_type=>'attendance.notice_requested',
     p_entity_kind=>'conversation',p_entity_id=>new.id,
     p_payload=>jsonb_build_object('notice_id',notice_id),
     p_metadata=>'{}'::jsonb);
 end if;
 return new;
end; $$;
revoke all on function public.fn_atendimento_emitir_aviso() from public,anon,authenticated;
grant execute on function public.fn_atendimento_emitir_aviso() to service_role;
-- Substitui, sem duplicar, o aviso web antigo que nao tinha protocolo.
drop trigger if exists trg_webchat_avisar_encerramento on public.conversations;
drop trigger if exists trg_atendimento_emitir_aviso on public.conversations;
create trigger trg_atendimento_emitir_aviso after insert or update of status,assigned_to_user_id,last_inbound_at
 on public.conversations for each row execute function public.fn_atendimento_emitir_aviso();

create or replace function public.fn_webchat_avisar_inicio()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.conversations;
begin
 select * into c from public.conversations where id=new.source_conversation_id
   and organization_id=new.organization_id and contact_id=new.contact_id;
 if not found or c.channel<>'webchat' or c.status in ('closed','resolved','archived')
   or new.revoked_at is not null or new.expires_at<=now() then return new; end if;
 insert into public.webchat_messages(organization_id,visitor_session_id,source_conversation_id,direction,body,idempotency_key,metadata,created_at)
 values(new.organization_id,new.id,c.id,'system',
   public.fn_atendimento_texto_aviso('iniciado',c.service_protocol),
   md5(c.service_protocol || ':iniciado:' || coalesce(c.assigned_to_user_id::text,''))::uuid,
   jsonb_build_object('service_protocol',c.service_protocol,'attendance_notice','iniciado'),clock_timestamp())
 on conflict(visitor_session_id,direction,idempotency_key) do nothing;
 return new;
end; $$;
revoke all on function public.fn_webchat_avisar_inicio() from public,anon,authenticated;
grant execute on function public.fn_webchat_avisar_inicio() to service_role;
drop trigger if exists trg_webchat_avisar_inicio on public.webchat_visitor_sessions;
create trigger trg_webchat_avisar_inicio after insert on public.webchat_visitor_sessions
 for each row execute function public.fn_webchat_avisar_inicio();
notify pgrst, 'reload schema';
