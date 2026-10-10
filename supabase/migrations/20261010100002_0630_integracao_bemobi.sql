-- manifest: A conexão genérica de ERP passa a aceitar a Bemobi/7AZ como dona das faturas e meios de pagamento, sem expor as credenciais ao navegador.

-- `erp_integrations` nasceu genérica, mas a primeira fatia fechou o vocabulário
-- em IXC. Bemobi é o segundo adaptador implementado: ampliar o CHECK somente
-- junto do cliente real evita uma linha configurável que o runtime não saiba
-- usar. Nenhum dado existente é reescrito.
alter table public.erp_integrations
  drop constraint if exists erp_integrations_provider_conhecido;

alter table public.erp_integrations
  add constraint erp_integrations_provider_conhecido
  check (provider in ('ixc', 'bemobi'));

comment on table public.erp_integrations is
  'Conexões server-side de ERP/provedor por organização. Credenciais nunca são servidas ao browser; adaptadores ativos: IXC e Bemobi/7AZ.';

notify pgrst, 'reload schema';
