-- manifest: Acompanhamento deterministico da IA: pergunta antes de encerrar por silencio, com prazo contado do aviso enviado e cancelamento por resposta ou handoff.
alter table public.attendance_notices drop constraint if exists attendance_notices_kind_check;
alter table public.attendance_notices add constraint attendance_notices_kind_check
 check (kind in ('iniciado','assumido','encerrado','inatividade'));
alter table public.attendance_notices add column if not exists source_message_id uuid;
alter table public.attendance_notices add column if not exists service_revision bigint;
alter table public.attendance_notices add column if not exists inactivity_close_after_minutes integer;
create unique index if not exists attendance_notices_inactivity_once
 on public.attendance_notices(organization_id,conversation_id,source_message_id)
 where kind='inatividade';

-- Uma leitura compartilhada pelo relogio e pelo portao imediatamente antes do
-- envio. So responde ao silencio DO CLIENTE depois de uma resposta enviada da
-- IA neste episodio; nunca trata IA travada/falha de entrega como abandono.
create or replace function public.fn_atendimento_inatividade_elegivel(p_org uuid,p_conversation uuid,p_source uuid,p_revision bigint)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists (
  select 1 from public.conversations c
  join public.organizations o on o.id=c.organization_id
  join public.contacts ct on ct.id=c.contact_id and ct.organization_id=c.organization_id
  join public.channel_sessions s on s.id=c.channel_session_id and s.organization_id=c.organization_id
  join public.messages m on m.id=p_source and m.organization_id=c.organization_id and m.conversation_id=c.id
  where c.organization_id=p_org and c.id=p_conversation and c.service_revision=p_revision
   and c.status in ('open','ai_handling') and not c.is_group
   and c.assigned_to_user_id is null and coalesce(c.assignee_kind,'')<>'user'
   and (c.bot_silenced_until is null or c.bot_silenced_until<=now())
   and not coalesce(ct.force_human,false) and not coalesce(ct.is_blocked,false)
   and o.status='active' and s.status='WORKING'
   and coalesce(s.metadata->>'disabled','false')<>'true'
   and o.settings->'routing'->'ai_inactivity' is not null
   and jsonb_typeof(o.settings->'routing'->'ai_inactivity')='object'
   and m.service_revision=c.service_revision and m.direction='outbound' and m.sent_via='ai'
   and m.status in ('sent','delivered','read') and m.sent_at is not null
   and c.last_inbound_at is not null and c.last_inbound_at<=m.sent_at
   and not exists (
    select 1 from public.messages newer
    where newer.organization_id=c.organization_id and newer.conversation_id=c.id
     and newer.service_revision=c.service_revision
     and not (coalesce(newer.metadata,'{}'::jsonb) ? 'attendance_notice')
     and (newer.created_at,newer.id)>(m.created_at,m.id))
   and not exists (
    select 1 from public.job_queue j where j.organization_id=c.organization_id
     and j.payload->>'conversation_id'=c.id::text and j.status in ('pending','running')
     and (j.payload->'service_boundary'->>'service_revision' is null
      or j.payload->'service_boundary'->>'service_revision'=c.service_revision::text))
   and not exists (
    select 1 from public.followup_enrollments f where f.organization_id=c.organization_id
     and f.conversation_id=c.id and f.status in ('active','waiting','waiting_reply','coletando','dormente'))
 );
$$;
revoke all on function public.fn_atendimento_inatividade_elegivel(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.fn_atendimento_inatividade_elegivel(uuid,uuid,uuid,bigint) to service_role;

create or replace function public.fn_atendimento_inatividade_aviso_valido(p_org uuid,p_notice uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.attendance_notices n
  where n.organization_id=p_org and n.id=p_notice and n.kind='inatividade'
   and public.fn_atendimento_inatividade_elegivel(p_org,n.conversation_id,n.source_message_id,n.service_revision));
$$;
revoke all on function public.fn_atendimento_inatividade_aviso_valido(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_atendimento_inatividade_aviso_valido(uuid,uuid) to service_role;

create or replace function public.fn_atendimento_inatividade_tick(p_org uuid,p_limite integer default 100)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg jsonb; aviso_min integer; espera_min integer; alvo record;
 c public.conversations; n public.attendance_notices; enviado_em timestamptz;
 texto text; n_id uuid; avisos integer:=0; encerrados integer:=0; web_count integer;
begin
 select settings->'routing'->'ai_inactivity' into cfg from public.organizations where id=p_org and status='active';
 if cfg is null or jsonb_typeof(cfg)<>'object' then return jsonb_build_object('avisos',0,'encerrados',0); end if;
 -- JSON antigo ou invalido nunca ativa encerramento por acidente.
 if coalesce(cfg->>'warn_after_minutes','')!~'^[0-9]{1,4}$'
  or coalesce(cfg->>'close_after_warning_minutes','')!~'^[0-9]{1,4}$' then
  return jsonb_build_object('avisos',0,'encerrados',0);
 end if;
 aviso_min:=(cfg->>'warn_after_minutes')::integer;
 espera_min:=(cfg->>'close_after_warning_minutes')::integer;
 if aviso_min not between 5 and 1440 or espera_min not between 5 and 1440 then
  return jsonb_build_object('avisos',0,'encerrados',0);
 end if;
 for alvo in
  select cv.id,cv.contact_id,m.id as source_id,cv.service_revision
  from public.conversations cv
  join lateral (
   select msg.id,msg.sent_at from public.messages msg
   where msg.organization_id=p_org and msg.conversation_id=cv.id and msg.service_revision=cv.service_revision
    and not (coalesce(msg.metadata,'{}'::jsonb) ? 'attendance_notice')
   order by msg.created_at desc,msg.id desc limit 1
  ) m on true
  left join public.attendance_notices prev on prev.organization_id=p_org and prev.conversation_id=cv.id
   and prev.source_message_id=m.id and prev.kind='inatividade'
  where cv.organization_id=p_org and cv.status in ('open','ai_handling')
   and m.sent_at<=now()-make_interval(mins=>aviso_min)
   and public.fn_atendimento_inatividade_elegivel(p_org,cv.id,m.id,cv.service_revision)
   -- Aviso sem recibo (pendente/falho) nao ocupa o lote nem permite fechamento.
   and (prev.id is null or exists(select 1 from public.messages receipt
     where receipt.organization_id=p_org and receipt.id=prev.id and receipt.status in ('sent','delivered','read')
       and receipt.sent_at<=now()-make_interval(mins=>prev.inactivity_close_after_minutes))
    or exists(select 1 from public.webchat_messages receipt where receipt.organization_id=p_org
       and receipt.id=prev.id and receipt.created_at<=now()-make_interval(mins=>prev.inactivity_close_after_minutes)))
  order by m.sent_at,cv.id limit greatest(1,least(p_limite,200))
 loop
  -- Mesma ordem do inbound/fechamento: contato antes da conversa. Releitura
  -- depois do lock cancela a decisao se cliente respondeu/humano assumiu.
  perform public.fn_service_lock(p_org,alvo.contact_id);
  select * into c from public.conversations where organization_id=p_org and id=alvo.id for no key update;
  if c.contact_id is distinct from alvo.contact_id or
   not public.fn_atendimento_inatividade_elegivel(p_org,c.id,alvo.source_id,alvo.service_revision) then continue; end if;
  select * into n from public.attendance_notices where organization_id=p_org
   and conversation_id=c.id and kind='inatividade' and source_message_id=alvo.source_id;
  if not found then
   n_id:=gen_random_uuid();
   texto:='Conseguiu resolver ou precisa de mais ajuda? Se precisar, responda por aqui. Sem retorno, vou encerrar este atendimento em '||espera_min||' minutos por falta de resposta. Isso não confirma que o problema foi resolvido.';
   if c.channel='webchat' then
    insert into public.webchat_messages(id,organization_id,visitor_session_id,source_conversation_id,direction,body,idempotency_key,metadata)
    select n_id,p_org,s.id,c.id,'system',texto,n_id,
      jsonb_build_object('attendance_notice','inatividade','service_protocol',c.service_protocol)
    from public.webchat_visitor_sessions s where s.organization_id=p_org and s.source_conversation_id=c.id
     and s.revoked_at is null and s.expires_at>now() order by s.created_at desc limit 1;
    get diagnostics web_count=row_count;
    if web_count=0 then continue; end if;
   end if;
   insert into public.attendance_notices(id,organization_id,conversation_id,protocol,kind,body,source_message_id,service_revision,inactivity_close_after_minutes)
    values(n_id,p_org,c.id,c.service_protocol,'inatividade',texto,alvo.source_id,c.service_revision,espera_min);
   if c.channel<>'webchat' then
    perform public.emit_event(p_organization_id=>p_org,p_event_type=>'attendance.notice_requested',
      p_entity_kind=>'conversation',p_entity_id=>c.id,p_payload=>jsonb_build_object('notice_id',n_id),p_metadata=>'{}'::jsonb);
   end if;
   avisos:=avisos+1;
  else
   enviado_em:=null;
   if c.channel='webchat' then
    select created_at into enviado_em from public.webchat_messages where organization_id=p_org and id=n.id;
   else
    select sent_at into enviado_em from public.messages where organization_id=p_org and id=n.id
      and conversation_id=c.id and status in ('sent','delivered','read');
   end if;
   if enviado_em is null or n.inactivity_close_after_minutes is null
    or enviado_em>now()-make_interval(mins=>n.inactivity_close_after_minutes) then continue; end if;
   perform public.fn_service_status(p_org,c.id,'closed',c.service_revision);
   -- O trigger padrao continua sendo o dono do aviso final e do protocolo.
   -- Muda apenas o texto deste encerramento, antes de a transacao ficar visivel.
   texto:='Como não recebemos seu retorno, este atendimento foi encerrado por falta de resposta. Protocolo: '||c.service_protocol||'. Se precisar de ajuda, envie uma nova mensagem. O encerramento não confirma a solução do problema.';
   update public.attendance_notices set body=texto where organization_id=p_org
    and conversation_id=c.id and protocol=c.service_protocol and kind='encerrado';
   update public.webchat_messages set body=texto where organization_id=p_org
    and source_conversation_id=c.id and metadata->>'service_protocol'=c.service_protocol
    and metadata->>'attendance_notice'='encerrado';
   encerrados:=encerrados+1;
  end if;
 end loop;
 return jsonb_build_object('avisos',avisos,'encerrados',encerrados);
end; $$;
revoke all on function public.fn_atendimento_inatividade_tick(uuid,integer) from public,anon,authenticated;
grant execute on function public.fn_atendimento_inatividade_tick(uuid,integer) to service_role;
notify pgrst,'reload schema';
