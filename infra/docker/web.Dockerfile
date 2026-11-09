# syntax=docker/dockerfile:1
# BI-Rem customer portal (Next.js 16, output: 'standalone') production image.
#
#   docker build -f infra/docker/web.Dockerfile -t birem/web \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .
#
# NEXT_PUBLIC_* variables are inlined into the browser bundle at build time, so they are build
# args here (one image per environment). Server-only variables (API_INTERNAL_URL,
# AUTH_COOKIE_SECURE) are read at runtime.
#
# Runtime contract: node apps/web/server.js on PORT 3000.

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0
ARG TURBO_VERSION=2.11.10

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_INTEGRITY_KEYS=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN apk add --no-cache libc6-compat \
    && corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /repo

# ---------------------------------------------------------------------------
FROM base AS pruner
ARG TURBO_VERSION
COPY . .
RUN pnpm dlx "turbo@${TURBO_VERSION}" prune @bi-rem/web --docker

# ---------------------------------------------------------------------------
FROM base AS installer
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_APP_NAME=BI-Rem
ARG NEXT_PUBLIC_APP_URL=

ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

COPY --from=pruner /repo/.npmrc ./.npmrc
COPY --from=pruner /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY --from=pruner /repo/out/full/ ./
RUN pnpm turbo run build --filter=@bi-rem/web

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="bi-rem-web" \
      org.opencontainers.image.description="BI-Rem customer portal (Next.js)" \
      org.opencontainers.image.source="https://github.com/wouapit999/wouapit999" \
      org.opencontainers.image.revision="${GIT_SHA}"

RUN apk add --no-cache tini \
    && addgroup -S -g 1001 birem \
    && adduser -S -u 1001 -G birem -h /app birem

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# The standalone bundle keeps the monorepo layout (apps/web/server.js + pruned node_modules).
# Static assets are not part of the standalone output and are copied separately. The app has
# no public/ folder today; add a COPY line for it when one is introduced.
COPY --from=installer --chown=birem:birem /repo/apps/web/.next/standalone ./
COPY --from=installer --chown=birem:birem /repo/apps/web/.next/static ./apps/web/.next/static

USER birem
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
