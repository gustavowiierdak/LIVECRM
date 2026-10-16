-- manifest: O provider interno do atendimento web passa a fazer parte explicitamente do vocabulário fechado de canais, mantendo banco e ChannelProvider idênticos.

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
  check (provider in (
    'waha',
    'meta_cloud',
    'zernio',
    'wacalls',
    'zernio_social',
    'datafy',
    'webchat'
  ));

notify pgrst, 'reload schema';
