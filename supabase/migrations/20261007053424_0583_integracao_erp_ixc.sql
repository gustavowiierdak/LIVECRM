-- manifest: A integração IXC guarda credencial cifrada por organização em conexão server-side, sem leitura pelo navegador.
-- 0583 — conexão segura com ERP/provedor, começando pelo IXC.
--
-- A tabela é genérica no limite do core (`provider`), mas só aceita IXC nesta
-- fatia: aceitar nomes sem adaptador criaria conexões que a aplicação nunca
-- consegue usar. A credencial é server-side only; RLS sem policy + REVOKE é
-- deliberadamente mais restritivo que expor a linha pelo PostgREST.

create table if not exists public.erp_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  base_url text not null,
  credential_encrypted bytea not null,
  enabled boolean not null default true,
  resources jsonb not null default '{"customers":true,"contracts":true,"receivables":true,"service_orders":true}'::jsonb,
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint erp_integrations_provider_conhecido check (provider in ('ixc')),
  constraint erp_integrations_base_url_https check (base_url ~ '^https://[^/?#]+$'),
  constraint erp_integrations_resources_objeto check (jsonb_typeof(resources) = 'object'),
  constraint erp_integrations_org_provider_unico unique (organization_id, provider)
);

comment on table public.erp_integrations is
  'Conexões server-side de ERP/provedor por organização. O segredo nunca é servido ao browser; IXC é o primeiro adaptador.';
comment on column public.erp_integrations.resources is
  'Grupos autorizados para uso futuro no atendimento/IA; não significa que já foram importados.';

alter table public.erp_integrations enable row level security;
revoke all on table public.erp_integrations from public, anon, authenticated;
grant all on table public.erp_integrations to service_role;

drop trigger if exists trg_erp_integrations_updated_at on public.erp_integrations;
create trigger trg_erp_integrations_updated_at
before update on public.erp_integrations
for each row execute function public.fn_set_updated_at();

notify pgrst, 'reload schema';
