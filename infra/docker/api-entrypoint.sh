#!/bin/sh
# Entrypoint for the BI-Rem API image.
#
#   (no args) / start   -> optionally run migrations (RUN_MIGRATIONS=true), then start the API
#   migrate             -> run `prisma migrate deploy` and exit (used by Fly release_command,
#                          ECS one-off tasks and the db-migrate workflow)
#   seed                -> not available in this image (seed runs from the repo, see README)
#   anything else       -> executed verbatim (debugging: `sh`, `node --version`, ...)
#
# The Prisma CLI is installed globally in the image; the schema and migrations are copied to
# /app/prisma together with a minimal runtime prisma.config.ts.
set -eu

PRISMA_CONFIG="${PRISMA_CONFIG:-/app/prisma/prisma.config.ts}"
APP_ENTRY="${APP_ENTRY:-/app/apps/api/dist/main.js}"

log() {
  printf '%s [entrypoint] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

require_database_url() {
  if [ -z "${DIRECT_URL:-}" ] && [ -z "${DATABASE_URL:-}" ]; then
    log "DATABASE_URL (or DIRECT_URL) must be set to run migrations"
    exit 64
  fi
}

run_migrations() {
  require_database_url
  log "applying pending Prisma migrations (config: ${PRISMA_CONFIG})"
  prisma migrate deploy --config "${PRISMA_CONFIG}"
  log "migrations applied"
}

command_name="${1:-start}"
case "${command_name}" in
  start)
    if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
      run_migrations
    fi
    log "starting API (NODE_ENV=${NODE_ENV:-unset}, port ${API_PORT:-4000})"
    exec node "${APP_ENTRY}"
    ;;
  migrate)
    run_migrations
    ;;
  seed)
    log "seeding is not bundled in the runtime image; run 'pnpm db:seed' from a checkout"
    exit 64
    ;;
  *)
    exec "$@"
    ;;
esac
