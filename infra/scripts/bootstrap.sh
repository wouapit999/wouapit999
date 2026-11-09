#!/usr/bin/env bash
# BI-Rem local bootstrap: checks the toolchain, prepares .env files, starts the docker
# services, waits for Postgres, then generates the Prisma client, migrates and seeds.
#
#   infra/scripts/bootstrap.sh            # full bootstrap
#   infra/scripts/bootstrap.sh --no-seed  # skip the seed
#   SKIP_INSTALL=1 infra/scripts/bootstrap.sh
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/infra/docker/docker-compose.yml"
REQUIRED_NODE_MAJOR=22
REQUIRED_PNPM_MAJOR=10
PG_WAIT_SECONDS="${PG_WAIT_SECONDS:-90}"
SEED=1

usage() {
  sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "${arg}" in
    --no-seed) SEED=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: ${arg}" >&2; usage; exit 64 ;;
  esac
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ok\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not installed. $2"
}

log "Checking toolchain"
require_cmd node "Install Node ${REQUIRED_NODE_MAJOR} (see .nvmrc), e.g. with fnm or nvm."
require_cmd pnpm "Run: corepack enable && corepack prepare \$(node -p \"require('${REPO_ROOT}/package.json').packageManager\") --activate"
require_cmd docker "Install Docker Desktop or Docker Engine with the compose plugin."

node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "${node_major}" -eq "${REQUIRED_NODE_MAJOR}" ]] || fail "Node ${REQUIRED_NODE_MAJOR}.x required, found $(node --version)"
pnpm_major="$(pnpm --version | cut -d. -f1)"
[[ "${pnpm_major}" -ge "${REQUIRED_PNPM_MAJOR}" ]] || fail "pnpm ${REQUIRED_PNPM_MAJOR}.x required, found $(pnpm --version)"
docker compose version >/dev/null 2>&1 || fail "docker compose (v2 plugin) is required"
docker info >/dev/null 2>&1 || fail "the Docker daemon is not running"
ok "node $(node --version), pnpm $(pnpm --version), $(docker compose version --short)"

log "Preparing environment files"
copy_env() {
  local example="$1" target="$2"
  if [[ -f "${target}" ]]; then
    ok "${target#"${REPO_ROOT}"/} exists (left untouched)"
  else
    cp "${example}" "${target}"
    ok "created ${target#"${REPO_ROOT}"/} from $(basename "${example}")"
  fi
}
copy_env "${REPO_ROOT}/.env.example" "${REPO_ROOT}/.env"
for ws in apps/api apps/web apps/admin packages/db; do
  [[ -f "${REPO_ROOT}/${ws}/.env.example" ]] && copy_env "${REPO_ROOT}/${ws}/.env.example" "${REPO_ROOT}/${ws}/.env"
done

if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  log "Installing dependencies"
  (cd "${REPO_ROOT}" && pnpm install --frozen-lockfile)
fi

log "Starting postgres, redis and mailpit"
docker compose -f "${COMPOSE_FILE}" up -d postgres redis mailpit

log "Waiting for Postgres (up to ${PG_WAIT_SECONDS}s)"
deadline=$(( SECONDS + PG_WAIT_SECONDS ))
until docker compose -f "${COMPOSE_FILE}" exec -T postgres pg_isready -U birem -d birem -h 127.0.0.1 >/dev/null 2>&1; do
  if (( SECONDS >= deadline )); then
    docker compose -f "${COMPOSE_FILE}" logs --tail=50 postgres >&2
    fail "Postgres did not become ready in time"
  fi
  sleep 2
done
ok "Postgres is accepting connections"

log "Generating Prisma client, applying migrations"
(cd "${REPO_ROOT}" && pnpm db:generate && pnpm db:migrate)

if (( SEED )); then
  log "Seeding"
  (cd "${REPO_ROOT}" && pnpm db:seed)
fi

cat <<MSG

Bootstrap complete.
  Postgres  postgresql://birem:birem@localhost:5432/birem
  Redis     redis://localhost:6379
  Mailpit   http://localhost:8025

Next: pnpm dev   (api http://localhost:4000/docs, web :3000, admin :3001)
MSG
