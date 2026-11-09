#!/usr/bin/env bash
# Restore a pg_dump custom-format backup produced by db-backup.sh into a Postgres database.
#
#   DATABASE_URL=postgresql://... infra/scripts/db-restore.sh backups/birem-birem-20261109T100000Z.dump
#   infra/scripts/db-restore.sh --clean <file>        # drop existing objects first
#   infra/scripts/db-restore.sh --neon-branch restore-20261109 <file>
#                                                      # restore into a fresh Neon branch (needs neonctl)
#
# Safety: refuses to restore into a database whose name contains "prod" unless FORCE=1.
#
# Neon PITR alternative (preferred for recent mistakes, no dump needed):
#   neonctl branches create --project-id $NEON_PROJECT_ID --name restore-<ts> \
#     --parent main --timestamp 2026-11-09T09:55:00Z
#   # verify data on the branch, then either point the API at it or
#   neonctl branches restore main ^self@2026-11-09T09:55:00Z   # resets main to that point
set -Eeuo pipefail

CLEAN=0
NEON_BRANCH=""
FILE=""
while (( $# )); do
  case "$1" in
    --clean) CLEAN=1; shift ;;
    --neon-branch) NEON_BRANCH="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) FILE="$1"; shift ;;
  esac
done

[[ -n "${FILE}" && -f "${FILE}" ]] || { echo "backup file required" >&2; exit 64; }
command -v pg_restore >/dev/null || { echo "pg_restore (postgresql-client 17) is required" >&2; exit 1; }

if [[ -f "${FILE}.sha256" ]]; then
  echo "==> verifying checksum"
  ( cd "$(dirname "${FILE}")" && sha256sum --check --quiet "$(basename "${FILE}").sha256" )
fi

URL="${DIRECT_URL:-${DATABASE_URL:-}}"
if [[ -n "${NEON_BRANCH}" ]]; then
  command -v neonctl >/dev/null || { echo "neonctl is required for --neon-branch" >&2; exit 1; }
  [[ -n "${NEON_PROJECT_ID:-}" ]] || { echo "NEON_PROJECT_ID must be set" >&2; exit 64; }
  echo "==> creating Neon branch ${NEON_BRANCH}"
  neonctl branches create --project-id "${NEON_PROJECT_ID}" --name "${NEON_BRANCH}" --output json >/dev/null
  URL="$(neonctl connection-string "${NEON_BRANCH}" --project-id "${NEON_PROJECT_ID}" --database-name birem)"
fi
[[ -n "${URL}" ]] || { echo "DIRECT_URL or DATABASE_URL must be set" >&2; exit 64; }

URL="$(sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//' <<<"${URL}")"
DB_NAME="$(sed -E 's#^[a-z]+://[^/]+/([^?]+).*#\1#' <<<"${URL}")"
HOST="$(sed -E 's#^[a-z]+://([^@]+@)?([^/:]+).*#\2#' <<<"${URL}")"

if [[ "${DB_NAME}${HOST}" == *prod* && "${FORCE:-0}" != "1" ]]; then
  echo "refusing to restore into '${DB_NAME}' on ${HOST} (looks like production). Set FORCE=1 to override." >&2
  exit 1
fi

echo "==> restoring $(basename "${FILE}") into ${DB_NAME} on ${HOST} (clean=${CLEAN})"
args=(--dbname "${URL}" --no-owner --no-privileges --exit-on-error --single-transaction --jobs=1)
(( CLEAN )) && args+=(--clean --if-exists)
pg_restore "${args[@]}" "${FILE}"

echo "==> checking Prisma migration state"
if command -v psql >/dev/null; then
  psql "${URL}" -Atc 'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5' || true
fi
echo "==> done. Run 'pnpm db:migrate' to apply migrations newer than the backup."
