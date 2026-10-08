#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

cli() { npx --yes supabase "$@"; }

# Linux containers can reach a host-local Supabase through `--network host`.
# Docker Desktop on macOS runs containers in a VM, so use its explicit host
# gateway instead.  This keeps the local stack usable on both developer hosts.
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

json_value() {
  local key="$1"
  node -e 'let s=""; process.stdin.on("data", c => s += c).on("end", () => {
    const v = JSON.parse(s)[process.argv[1]];
    process.stdout.write(v == null ? "" : String(v));
  })' "$key"
}

start_without_legacy_migrations() {
  local backup_dir
  backup_dir="$(mktemp -d "${TMPDIR:-/tmp}/deskcomm-migrations.XXXXXX")"
  restore() {
    # O EXIT trap pode executar depois que esta função saiu do escopo. Não
    # dependa de uma variável local no trap: com `set -u`, isso mascara o erro
    # real do `supabase start` como "backup: unbound variable".
    if [[ -d "${DESKCOMM_MIGRATIONS_BACKUP_DIR:-}/migrations" ]]; then
      rm -rf supabase/migrations
      mv "$DESKCOMM_MIGRATIONS_BACKUP_DIR/migrations" supabase/migrations
    fi
    if [[ -n "${DESKCOMM_MIGRATIONS_BACKUP_DIR:-}" ]]; then
      rmdir "$DESKCOMM_MIGRATIONS_BACKUP_DIR" 2>/dev/null || true
    fi
    DESKCOMM_MIGRATIONS_BACKUP_DIR=""
  }
  DESKCOMM_MIGRATIONS_BACKUP_DIR="$backup_dir"
  trap restore EXIT

  # A cadeia histórica contém migrations fora de ordem e dependências que só
  # existiam no Supabase Cloud. O baseline é o artefato de instalação fresca.
  mv supabase/migrations "$backup_dir/migrations"
  mkdir supabase/migrations
  cli start "$@"
  restore
  trap - EXIT
}

status_json() { cli status -o json; }

apply_baseline() {
  local db_url container_db_url
  db_url="$(status_json | json_value DB_URL)"
  [[ -n "$db_url" && "$db_url" != "null" ]] || {
    printf 'Supabase não retornou DB_URL.\n' >&2
    return 1
  }
  container_db_url="$(db_url_for_container "$db_url")"
  postgres_container postgres:15-alpine \
    psql "$container_db_url" -v ON_ERROR_STOP=1 -c \
    'create extension if not exists "uuid-ossp";
     create extension if not exists pgcrypto;
     create extension if not exists vector;
     create extension if not exists citext;
     create extension if not exists pg_trgm;'
  postgres_container \
    -v "$ROOT_DIR/supabase/baseline.sql:/tmp/deskcomm-baseline.sql:ro" \
    postgres:15-alpine \
    psql "$container_db_url" -v ON_ERROR_STOP=1 -f /tmp/deskcomm-baseline.sql
}

case "${1:-}" in
  start)
    start_without_legacy_migrations
    apply_baseline
    ;;
  status)
    status_json
    ;;
  apply-baseline)
    apply_baseline
    ;;
  stop)
    cli stop
    ;;
  *)
    printf 'Uso: %s {start|status|apply-baseline|stop}\n' "$0"
    exit 2
    ;;
esac
