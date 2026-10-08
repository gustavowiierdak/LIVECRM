#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${LOCAL_ENV_FILE:-.env.local}"
COMPOSE=(docker compose -f docker-compose.local.yml --env-file "$ENV_FILE")

db_url_for_container() {
  local db_url="$1"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    db_url="${db_url/127.0.0.1/host.docker.internal}"
    db_url="${db_url/localhost/host.docker.internal}"
  fi
  printf '%s' "$db_url"
}

postgres_container() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    docker run --rm --add-host=host.docker.internal:host-gateway "$@"
  else
    docker run --rm --network host "$@"
  fi
}

usage() {
  printf 'Uso: %s {up|down|restart|status|logs|supabase-status|reset}\n' "$0"
}

require_env() {
  if [[ ! -s "$ENV_FILE" ]]; then
    printf 'Erro: %s não existe. Execute ./ubuntu-local-installer.sh primeiro.\n' "$ENV_FILE" >&2
    exit 1
  fi
}

ensure_supabase() {
  if ! ./scripts/local-supabase.sh status >/dev/null 2>&1; then
    ./scripts/local-supabase.sh start
  fi
}

ensure_encryption_key() {
  local key db_url container_db_url
  key="$(awk -F= '$1 == "NUVEMSHOP_OAUTH_ENCRYPTION_KEY" { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE")"
  if [[ -z "$key" ]]; then
    key="$(openssl rand -hex 32)"
    printf '\nNUVEMSHOP_OAUTH_ENCRYPTION_KEY=%s\n' "$key" >> "$ENV_FILE"
  fi
  db_url="$(./scripts/local-supabase.sh status | node -e 'let s=""; process.stdin.on("data", c => s += c).on("end", () => process.stdout.write(JSON.parse(s).DB_URL || ""))')"
  [[ -n "$db_url" ]] || { printf 'Erro: Supabase local não retornou DB_URL.\n' >&2; exit 1; }
  container_db_url="$(db_url_for_container "$db_url")"
  postgres_container postgres:15-alpine psql "$container_db_url" -v ON_ERROR_STOP=1 -c \
    "insert into private.app_secrets (name, value) values ('nuvemshop_oauth_key', '$key') on conflict (name) do update set value = excluded.value, updated_at = now();" \
    >/dev/null
}

case "${1:-}" in
  up)
    ensure_supabase
    ./scripts/local-env.sh ensure
    require_env
    ensure_encryption_key
    "${COMPOSE[@]}" up -d --build
    ;;
  down)
    "${COMPOSE[@]}" down
    ./scripts/local-supabase.sh stop || true
    ;;
  restart)
    require_env
    "${COMPOSE[@]}" restart
    ;;
  status)
    require_env
    ./scripts/local-supabase.sh status
    "${COMPOSE[@]}" ps
    ;;
  logs)
    require_env
    "${COMPOSE[@]}" logs -f --tail=200 "${2:-app}"
    ;;
  supabase-status)
    ./scripts/local-supabase.sh status
    ;;
  reset)
    require_env
    "${COMPOSE[@]}" down
    ./scripts/local-supabase.sh stop
    ./scripts/local-supabase.sh start
    "${COMPOSE[@]}" up -d
    ;;
  *)
    usage
    exit 2
    ;;
esac
