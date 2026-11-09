#!/usr/bin/env bash
# fly deploy wrapper for the BI-Rem API.
#
#   infra/scripts/deploy-api.sh staging                 # build image locally with fly, deploy
#   infra/scripts/deploy-api.sh production <image-ref>  # deploy a CI-built image by digest
#
# Env: FLY_API_TOKEN (CI) or `fly auth login`, FLY_APP_STAGING / FLY_APP_PRODUCTION to override
# app names, SMOKE_URL to override the smoke-test base URL, SKIP_SMOKE=1 to skip it.
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG="${REPO_ROOT}/infra/fly/api.fly.toml"
ENVIRONMENT="${1:-}"
IMAGE="${2:-}"

usage() { echo "usage: $0 <staging|production> [image-ref]" >&2; exit 64; }
[[ -n "${ENVIRONMENT}" ]] || usage

case "${ENVIRONMENT}" in
  staging)
    APP="${FLY_APP_STAGING:-bi-rem-api-staging}"
    DEFAULT_SMOKE_URL="https://${APP}.fly.dev"
    ;;
  production)
    APP="${FLY_APP_PRODUCTION:-bi-rem-api}"
    DEFAULT_SMOKE_URL="https://${APP}.fly.dev"
    if [[ -z "${CI:-}" && -t 0 ]]; then
      read -r -p "Deploy to PRODUCTION app ${APP}? Type the app name to confirm: " confirm
      [[ "${confirm}" == "${APP}" ]] || { echo "aborted" >&2; exit 1; }
    fi
    ;;
  *) usage ;;
esac

command -v fly >/dev/null 2>&1 || command -v flyctl >/dev/null 2>&1 || {
  echo "flyctl is required: https://fly.io/docs/flyctl/install/" >&2; exit 1; }
FLY_BIN="$(command -v fly || command -v flyctl)"

GIT_SHA="$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || echo unknown)"
args=(deploy --app "${APP}" --config "${CONFIG}" --remote-only --yes --wait-timeout 600
      --label "git-sha=${GIT_SHA}" --env "GIT_SHA=${GIT_SHA}")

if [[ -n "${IMAGE}" ]]; then
  echo "==> deploying ${IMAGE} to ${APP}"
  args+=(--image "${IMAGE}")
else
  echo "==> building ${REPO_ROOT}/infra/docker/api.Dockerfile with Fly builders and deploying to ${APP}"
  args+=(--dockerfile "${REPO_ROOT}/infra/docker/api.Dockerfile" --build-arg "GIT_SHA=${GIT_SHA}")
  # The build context must be the repo root so turbo prune sees the whole workspace.
  cd "${REPO_ROOT}"
fi

"${FLY_BIN}" "${args[@]}"

echo "==> release status"
"${FLY_BIN}" releases --app "${APP}" --json 2>/dev/null | head -c 1500 || true
echo

if [[ "${SKIP_SMOKE:-0}" != "1" ]]; then
  "${REPO_ROOT}/infra/scripts/smoke-test.sh" "${SMOKE_URL:-${DEFAULT_SMOKE_URL}}"
fi

cat <<MSG

Rollback if needed:
  ${FLY_BIN} releases --app ${APP}
  ${FLY_BIN} deploy --app ${APP} --config ${CONFIG} --image <previous image ref>
MSG
