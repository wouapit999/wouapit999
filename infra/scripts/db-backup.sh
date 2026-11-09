#!/usr/bin/env bash
# Logical backup of the BI-Rem database (Neon or any Postgres) with pg_dump.
#
#   DATABASE_URL=postgresql://... infra/scripts/db-backup.sh [output-dir]
#   infra/scripts/db-backup.sh --upload s3://bi-rem-backups/production    # needs aws cli
#
# Produces <dir>/birem-<db>-<UTC timestamp>.dump (pg_dump custom format, compressed) plus a
# .sha256 file. Restore with infra/scripts/db-restore.sh.
#
# Neon notes
# - Prefer the *direct* (non-pooled) endpoint: `DIRECT_URL` is used when set, otherwise
#   DATABASE_URL. PgBouncer in transaction mode breaks pg_dump's session-level locks.
# - Neon keeps a point-in-time-restore (PITR) history (7 days on Launch, up to 30 on Scale):
#   `neon branches create --parent main --timestamp 2026-11-09T10:00:00Z` creates a branch
#   at that instant with zero downtime. Use PITR for "undo the last migration" and this
#   script for off-platform copies (compliance, retention beyond the PITR window, migrating
#   providers).
# - pg_dump must be >= the server major version (Postgres 17): `pg_dump --version`.
set -Eeuo pipefail

UPLOAD_TARGET=""
OUT_DIR="${BACKUP_DIR:-./backups}"
while (( $# )); do
  case "$1" in
    --upload) UPLOAD_TARGET="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) OUT_DIR="$1"; shift ;;
  esac
done

URL="${DIRECT_URL:-${DATABASE_URL:-}}"
[[ -n "${URL}" ]] || { echo "DIRECT_URL or DATABASE_URL must be set" >&2; exit 64; }
command -v pg_dump >/dev/null || { echo "pg_dump (postgresql-client 17) is required" >&2; exit 1; }

# Prisma-style `?schema=public` is not understood by libpq; strip it, keep sslmode etc.
URL="$(sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//' <<<"${URL}")"
DB_NAME="$(sed -E 's#^[a-z]+://[^/]+/([^?]+).*#\1#' <<<"${URL}")"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${OUT_DIR}"
FILE="${OUT_DIR}/birem-${DB_NAME}-${STAMP}.dump"

echo "==> pg_dump ${DB_NAME} -> ${FILE}"
pg_dump "${URL}" \
  --format=custom --compress=zstd:6 \
  --no-owner --no-privileges \
  --file "${FILE}"

( cd "${OUT_DIR}" && sha256sum "$(basename "${FILE}")" > "$(basename "${FILE}").sha256" )
du -h "${FILE}" | awk '{print "==> size", $1}'

if [[ -n "${UPLOAD_TARGET}" ]]; then
  command -v aws >/dev/null || { echo "aws cli required for --upload" >&2; exit 1; }
  echo "==> uploading to ${UPLOAD_TARGET}/"
  aws s3 cp "${FILE}" "${UPLOAD_TARGET}/" --sse aws:kms --only-show-errors
  aws s3 cp "${FILE}.sha256" "${UPLOAD_TARGET}/" --only-show-errors
fi

echo "==> done. Verify with: pg_restore --list ${FILE} | head"
