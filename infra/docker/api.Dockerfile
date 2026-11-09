# syntax=docker/dockerfile:1
# BI-Rem API (NestJS) production image.
#
#   docker build -f infra/docker/api.Dockerfile -t birem/api --build-arg GIT_SHA=$(git rev-parse HEAD) .
#
# Stages
#   pruner    - `turbo prune` produces a minimal workspace (only @bi-rem/api and its deps)
#   installer - installs with the pruned lockfile, builds db -> shared -> api, then re-installs
#               production dependencies only
#   runner    - node:22-alpine, non-root, tini as PID 1, Prisma CLI for `migrate deploy`
#
# Runtime contract: node apps/api/dist/main.js listening on API_PORT (4000). The entrypoint
# runs `prisma migrate deploy` first when RUN_MIGRATIONS=true, or standalone via `migrate`.

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0
ARG TURBO_VERSION=2.11.10
ARG PRISMA_VERSION=7.10.1

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    # Corepack ships its own set of registry signing keys; disabling the integrity check keeps
    # old base images working after npm rotates them (the tarball is still TLS + SHA checked).
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
RUN pnpm dlx "turbo@${TURBO_VERSION}" prune @bi-rem/api --docker

# ---------------------------------------------------------------------------
FROM base AS installer
# Native modules (argon2) ship musl prebuilds; the toolchain is a fallback for source builds.
RUN apk add --no-cache python3 make g++ openssl

COPY --from=pruner /repo/.npmrc ./.npmrc
COPY --from=pruner /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY --from=pruner /repo/out/full/ ./
# `build` depends on ^build and ^generate (turbo.json), so db generate + shared build run first.
RUN pnpm turbo run build --filter=@bi-rem/api

# Drop devDependencies, keep the already-built workspace packages linked.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --prefer-offline

# ---------------------------------------------------------------------------
FROM base AS runner
ARG PRISMA_VERSION
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="bi-rem-api" \
      org.opencontainers.image.description="BI-Rem remittance platform API (NestJS)" \
      org.opencontainers.image.source="https://github.com/wouapit999/wouapit999" \
      org.opencontainers.image.revision="${GIT_SHA}"

# tini: proper signal forwarding/zombie reaping. openssl: required by the Prisma schema engine.
RUN apk add --no-cache tini openssl \
    && npm install -g --no-fund --no-audit "prisma@${PRISMA_VERSION}" \
    && npm cache clean --force \
    && addgroup -S -g 1001 birem \
    && adduser -S -u 1001 -G birem -h /app birem

WORKDIR /app
# CHECKPOINT_DISABLE / PRISMA_HIDE_UPDATE_MESSAGE: the Prisma CLI must not phone home or write
# caches when the root filesystem is read-only.
ENV NODE_ENV=production \
    API_PORT=4000 \
    GIT_SHA=${GIT_SHA} \
    RUN_MIGRATIONS=false \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

# Workspace layout is preserved so pnpm's node_modules symlinks keep resolving.
COPY --from=installer --chown=birem:birem /repo/package.json ./package.json
COPY --from=installer --chown=birem:birem /repo/node_modules ./node_modules
COPY --from=installer --chown=birem:birem /repo/apps/api/package.json ./apps/api/package.json
COPY --from=installer --chown=birem:birem /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=installer --chown=birem:birem /repo/apps/api/dist ./apps/api/dist
COPY --from=installer --chown=birem:birem /repo/packages/db/package.json ./packages/db/package.json
COPY --from=installer --chown=birem:birem /repo/packages/db/node_modules ./packages/db/node_modules
COPY --from=installer --chown=birem:birem /repo/packages/db/dist ./packages/db/dist
COPY --from=installer --chown=birem:birem /repo/packages/shared/package.json ./packages/shared/package.json
# shared/dist imports zod from its own node_modules (pnpm isolated layout, no hoisting).
COPY --from=installer --chown=birem:birem /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=installer --chown=birem:birem /repo/packages/shared/dist ./packages/shared/dist

# Migration tooling: schema + migrations + a dependency-free runtime config.
COPY --from=installer --chown=birem:birem /repo/packages/db/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=installer --chown=birem:birem /repo/packages/db/prisma/migrations ./prisma/migrations
COPY --chown=birem:birem infra/docker/prisma.config.ts ./prisma/prisma.config.ts
COPY --chown=birem:birem --chmod=755 infra/docker/api-entrypoint.sh /usr/local/bin/birem-entrypoint

USER birem
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${API_PORT}/health/live" >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/birem-entrypoint"]
CMD ["start"]
