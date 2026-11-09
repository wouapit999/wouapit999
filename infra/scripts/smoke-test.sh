#!/usr/bin/env bash
# Post-deploy smoke test: probes the API health endpoints with retries and verifies the
# response bodies, then (optionally) the portals.
#
#   infra/scripts/smoke-test.sh https://api.staging.bi-rem.africa
#   infra/scripts/smoke-test.sh https://api.bi-rem.africa https://app.bi-rem.africa https://admin.bi-rem.africa
#
# Env: SMOKE_RETRIES (default 20), SMOKE_DELAY seconds (default 6), SMOKE_TIMEOUT (default 10),
#      EXPECTED_GIT_SHA (when set, the `/health/live` response is not checked for it — the API
#      does not expose it — but it is printed for traceability).
set -Eeuo pipefail

API_URL="${1:-}"
shift || true
PORTAL_URLS=("$@")

[[ -n "${API_URL}" ]] || { echo "usage: $0 <api-url> [portal-url...]" >&2; exit 64; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }

RETRIES="${SMOKE_RETRIES:-20}"
DELAY="${SMOKE_DELAY:-6}"
TIMEOUT="${SMOKE_TIMEOUT:-10}"
API_URL="${API_URL%/}"
failures=0

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# probe <name> <url> <expected-status> [grep-pattern]
probe() {
  local name="$1" url="$2" expected="$3" pattern="${4:-}"
  local attempt status body
  for (( attempt = 1; attempt <= RETRIES; attempt++ )); do
    body="$(curl -sS --max-time "${TIMEOUT}" -H 'Accept: application/json' -o - -w '\n%{http_code}' "${url}" 2>/dev/null || true)"
    status="${body##*$'\n'}"
    body="${body%$'\n'*}"
    if [[ "${status}" == "${expected}" ]] && { [[ -z "${pattern}" ]] || grep -Eq "${pattern}" <<<"${body}"; }; then
      log "PASS ${name} (${status}) after ${attempt} attempt(s)"
      return 0
    fi
    log "wait ${name}: got ${status:-no response} (attempt ${attempt}/${RETRIES})"
    sleep "${DELAY}"
  done
  log "FAIL ${name}: expected ${expected}${pattern:+ matching /${pattern}/}, last status ${status:-none}"
  [[ -n "${body}" ]] && printf '%s\n' "${body}" | head -c 2000 >&2
  failures=$(( failures + 1 ))
  return 1
}

log "Smoke testing ${API_URL}${EXPECTED_GIT_SHA:+ (expected sha ${EXPECTED_GIT_SHA})}"
probe "liveness"  "${API_URL}/health/live"  200 '"status":"ok"' || true
probe "readiness" "${API_URL}/health/ready" 200 '"status":"ok"' || true
probe "health"    "${API_URL}/health"       200 '"status":"ok"' || true
probe "openapi"   "${API_URL}/docs-json"    200 '"openapi"' || true
probe "metrics"   "${API_URL}/metrics"      200 'http_request_duration_seconds' || true
# Authenticated route must reject anonymous callers (proves guards are wired).
probe "auth-guard" "${API_URL}/v1/users/me" 401 || true

for portal in "${PORTAL_URLS[@]}"; do
  probe "portal ${portal}" "${portal%/}/" 200 '<html' || true
done

if (( failures > 0 )); then
  log "${failures} check(s) failed"
  exit 1
fi
log "all checks passed"
