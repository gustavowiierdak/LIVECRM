-- manifest: Reabertura de atendimento encerrado reinicia o roteamento e a IA, sem herdar o setor ou a passagem humana do episódio anterior.
-- A revisão e a demanda já eram novas; as travas e o setor ainda eram antigos.
-- Pausas explícitas pelo canal (#off/resposta manual), bloqueio por teto de IA
-- e o ajuste de conservar o último atendente continuam intocados.
-- Recusa de consentimento nunca é desfeita.
create or replace function public.fn_service_inbound(p_message uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
 m public.messages;
 c public.conversations;
 d public.demandas;
 reopened boolean;
 keep_owner boolean;
 restart_automatic boolean;
 prior_handoff boolean;
 pre_contact uuid;
begin
 select * into m from public.messages where id = p_message;
 if not found or m.direction <> 'inbound' or m.service_revision is not null then return; end if;
 select * into c from public.conversations where id = m.conversation_id;
 if not found or c.organization_id is distinct from m.organization_id
    or c.channel_session_id is distinct from m.channel_session_id
    or not exists(select 1 from public.channel_sessions where id=m.channel_session_id and organization_id=m.organization_id)
 then raise exception 'service_scope_mismatch' using errcode='23503'; end if;
 if c.is_group or coalesce(c.group_chat_id,'') like '%@g.us' then return; end if;
 if c.contact_id is distinct from m.contact_id
    or not exists(select 1 from public.contacts where id=m.contact_id and organization_id=m.organization_id)
 then raise exception 'service_scope_mismatch' using errcode='23503'; end if;
 pre_contact:=c.contact_id;
 perform public.fn_service_lock(c.organization_id,c.contact_id);
 select * into c from public.conversations where id=m.conversation_id and organization_id=m.organization_id for no key update;
 if c.contact_id is distinct from pre_contact then raise exception 'service_contact_changed' using errcode='40001'; end if;
 if m.sent_at <= c.service_closed_at then return; end if;
 reopened := c.status in ('closed','resolved','archived');
 keep_owner := reopened and c.assigned_to_user_id is not null
   and coalesce((select o.settings->'routing'->'conversation_stays_with_attendant' = 'true'::jsonb
                   from public.organizations o where o.id = c.organization_id), false)
   and coalesce(public.fn_member_role_in_org(c.assigned_to_user_id,c.organization_id),'none')
     in ('agent','manager','admin');
 -- #off, resposta manual pelo celular e teto de IA são travas DURÁVEIS.
 -- Todo outro silêncio pertence ao atendimento encerrado.
 restart_automatic := reopened and not keep_owner
   and coalesce(c.last_handoff_reason,'') not in
     ('Comando #off enviado pelo celular', 'Atendimento manual pelo canal (resposta fora do CRM)',
      'orcamento_de_ia');
 prior_handoff := restart_automatic and c.last_handoff_at is not null;
 if not reopened then
   select x.* into d from public.demandas x join public.demanda_conversas dc on dc.demanda_id=x.id
    where x.id=c.current_demanda_id and x.organization_id=c.organization_id and x.contact_id=c.contact_id
      and dc.organization_id=c.organization_id and dc.conversation_id=c.id
      and dc.service_revision=c.service_revision and x.fechada_em is null;
 end if;
 if d.id is null then
   insert into public.demandas
     (organization_id,contact_id,aberta_em,origem,estado,dono_kind,dono_user_id,proximo_passo)
    values(c.organization_id,c.contact_id,m.sent_at,'inbound','aberta',
      case when keep_owner then 'humano' else 'ia' end,
      case when keep_owner then c.assigned_to_user_id else null end,
      'Responder à nova mensagem do cliente') returning * into d;
 end if;
 if reopened then
   update public.conversations set
     status=case when keep_owner then 'claimed' else 'open' end,
     status_changed_at=clock_timestamp(),
     service_revision=service_revision+1,service_started_at=m.sent_at,
     assigned_to_user_id=case when keep_owner then c.assigned_to_user_id else null end,
     assigned_at=case when keep_owner then clock_timestamp() else null end,
     assignee_kind=case when keep_owner then 'user' else null end,
     bot_silenced_until=case when keep_owner then 'infinity'::timestamptz
       when restart_automatic then null else c.bot_silenced_until end,
     last_handoff_at=case when restart_automatic then null else c.last_handoff_at end,
     last_handoff_reason=case when restart_automatic then null else c.last_handoff_reason end,
     -- O assunto escolhido na entrada do webchat permanece; WhatsApp volta ao
     -- roteador, sem levar a fila antiga de Cobrança para o novo "oi".
     atendimento_setor_id=case when keep_owner or c.channel='webchat'
       then c.atendimento_setor_id else null end,
     awaiting_since=case when keep_owner then c.awaiting_since else null end,
     active_ai_agent_id=null,
     active_intent=case when keep_owner then c.active_intent else null end,
     current_demanda_id=d.id
    where id=c.id and organization_id=c.organization_id returning * into c;
   -- force_human é global ao contato: só solte a trava originada NESTA
   -- passagem se não houver outro atendimento humano vivo e se a pessoa não
   -- recusou expressamente atendimento automatizado em formulário.
   if prior_handoff then
     update public.contacts p set force_human=false
      where p.id=c.contact_id and p.organization_id=c.organization_id
        and p.force_human
        and p.consent->'automated_service'->>'declined_at' is null
        and not exists (
          select 1 from public.conversations other
           where other.organization_id=c.organization_id and other.contact_id=c.contact_id
             and other.id<>c.id and other.status not in ('closed','resolved','archived')
             and (other.assigned_to_user_id is not null
               or other.bot_silenced_until>clock_timestamp())
        );
   end if;
 else
   update public.conversations set
     service_revision=service_revision+case when current_demanda_id is not null and current_demanda_id<>d.id then 1 else 0 end,
     service_started_at=case when current_demanda_id is not null and current_demanda_id<>d.id then m.sent_at else coalesce(service_started_at,m.sent_at) end,
     current_demanda_id=d.id
    where id=c.id and organization_id=c.organization_id returning * into c;
 end if;
 insert into public.demanda_conversas(organization_id,demanda_id,conversation_id,service_revision)
  values(c.organization_id,d.id,c.id,c.service_revision) on conflict(demanda_id,conversation_id)
  do update set service_revision=excluded.service_revision;
 update public.messages set service_revision=c.service_revision,demanda_id=d.id,demanda_revision=d.revision
  where id=m.id and organization_id=c.organization_id;
end; $$;
revoke execute on function public.fn_service_inbound(uuid) from public,anon,authenticated;
grant execute on function public.fn_service_inbound(uuid) to service_role;
