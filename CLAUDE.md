# BI-Rem — contributor & agent conventions

BI-Rem is a pan-African remittance / mobile-money platform built in 13 independently
deployable phases (see `docs/`). This repository holds the Phase 1 foundation code, the
full planning documentation for every phase, and **BI-Rem Lite** (`apps/lite`): the whole
programme at small scale in one deployable app (GitHub + Vercel + Neon). Lite illustrates the
roadmap; it never replaces a phase.

## Repository layout (pnpm workspaces + Turborepo)

| Path | Package name | Purpose |
|------|--------------|---------|
| `apps/api` | `@bi-rem/api` | NestJS 12 backend (REST + OpenAPI). Port 4000. |
| `apps/web` | `@bi-rem/web` | Next.js 16 **customer portal**. Port 3000. |
| `apps/admin` | `@bi-rem/admin` | Next.js 16 **admin portal**. Port 3001. |
| `apps/lite` | `@bi-rem/lite` | **BI-Rem Lite**: all 13 phases at small scale in one Next.js 16 app. Port 3002. Self-contained (own Prisma schema + database). Deploys on Vercel + Neon. |
| `packages/db` | `@bi-rem/db` | Prisma 7 schema v1, migrations, seed, exported `PrismaClient`. |
| `packages/shared` | `@bi-rem/shared` | Zod schemas, DTO types, enums, constants shared by api/web/admin. |
| `packages/config` | `@bi-rem/config` | Shared `tsconfig` and ESLint presets. |
| `infra/` | — | Docker, docker-compose, deploy scripts, fly.toml, Vercel config. |
| `.github/workflows` | — | CI/CD pipelines. |
| `docs/` | — | Roadmap, per-phase plans, architecture, handbooks; `docs/lite/` maps Lite to the roadmap. |

## Pinned stack (do not downgrade or swap)

- Node `22.x` (`.nvmrc`), pnpm `10.x`, TypeScript `^5.9` (NOT 7.x), Turborepo `^2.11`.
- Backend: `@nestjs/*` `^12`, `nestjs-pino` + `pino`, `@nestjs/swagger`, `@nestjs/terminus`,
  `@nestjs/throttler`, `@nestjs/config`, `class-validator`/`class-transformer` for DTOs,
  `@nestjs/jwt` + `passport-jwt`, `argon2` for password hashing, `prom-client` for metrics,
  `bullmq` + `ioredis` for queues (notifications), Jest `^30` + `supertest` for tests.
- Frontend: `next` `^16`, `react` `^19`, Tailwind CSS `^4`, `@tanstack/react-query` `^5`,
  `zod` `^4`. Use the App Router (`app/`), Server Components by default, `"use client"` only
  where needed. Vitest for unit tests.
- Data: `prisma` + `@prisma/client` `^7.10` (stable — NOT the 8.x RC), `@prisma/adapter-pg`
  + `pg` driver adapter (works for both local Postgres and Neon). `prisma.config.ts` at
  `packages/db/`. Generated client output: `packages/db/generated/` (git-ignored).
- Tooling: ESLint `^9` flat config, Prettier `^3`.

## Conventions

- ESM everywhere in packages (`"type": "module"`), NodeNext module resolution. NestJS app may
  compile to CJS if decorators demand it — keep whatever makes `pnpm build` pass.
- Every workspace exposes: `build`, `dev`, `lint`, `typecheck`, `test` (and `clean`).
  `packages/db` additionally exposes `generate`, `migrate:dev`, `migrate:deploy`, `seed`.
- Env vars are validated at boot with Zod (`apps/api/src/config/env.ts`, `apps/*/src/env.ts`).
  Document every var in the relevant `.env.example`. Never commit secrets.
- All IDs are `uuid` (Postgres `gen_random_uuid()`); all timestamps `timestamptz`; money is
  stored as `BIGINT` minor units + ISO-4217 `currency` column (never floats).
- Every mutating API request writes an `AuditLog` row (interceptor) with actor, action,
  resource, before/after diff, IP, user agent, correlation id.
- RBAC: `Role` ⟷ `Permission` many-to-many, `User` ⟷ `Role` many-to-many. Permissions are
  strings `resource:action` (e.g. `users:read`, `audit:read`, `roles:write`). Guards:
  `@Permissions('users:read')` + `PermissionsGuard`; `@Public()` bypasses JWT.
- Two user realms share one `User` table discriminated by `realm` enum: `CUSTOMER`, `ADMIN`.
  Customer portal logs into realm CUSTOMER; admin portal into realm ADMIN.
- API prefix `/v1`. OpenAPI at `/docs`. Health at `/health` (liveness `/health/live`,
  readiness `/health/ready`), Prometheus metrics at `/metrics`.
- Correlation id header `x-request-id` is accepted or generated and echoed.
- Commit messages: Conventional Commits (`feat(api): …`, `docs(phase-03): …`).

## Database schema v1 (Phase 1) — entity list

`User`, `Role`, `Permission`, `UserRole`, `RolePermission`, `RefreshToken`, `AuditLog`,
`Notification`, `NotificationTemplate`, `NotificationPreference`, `FeatureFlag`, `Setting`,
`ApiKey` (admin service accounts), `Outbox` (transactional outbox for events).
Enums: `UserRealm`, `UserStatus`, `NotificationChannel`, `NotificationStatus`, `AuditOutcome`.

## BI-Rem Lite (`apps/lite`) — conventions

Read `apps/lite/SPEC.md` (binding scope + money-movement rules) and `apps/lite/ARCHITECTURE.md`
before changing it. `apps/lite/AGENTS.md` applies too (Next.js 16 differs from older versions).

- **Self-contained.** No import from `@bi-rem/db`, `@bi-rem/shared` or `apps/api`; the only
  workspace dependency is `@bi-rem/config` (tsconfig + ESLint presets). Own Prisma schema at
  `apps/lite/prisma/schema.prisma`, own migrations, generated client at
  `apps/lite/src/generated/prisma` (git-ignored), own database.
- **No extra infrastructure.** No Redis, queue, object storage or external service: it must keep
  fitting Vercel Hobby + Neon Free. Background work runs inline in the request. Nothing is
  written to the file system at run time.
- **Stack.** Server Components + Server Actions for the UI, Route Handlers for `/api/**`, Node
  runtime only. Passwords: Node `crypto.scrypt`. Sessions: signed JWT (`jose`, HS256) in the
  httpOnly cookie `birem_session`. Env validated with Zod in `apps/lite/src/server/env.ts`;
  every variable documented in `apps/lite/.env.example` (a unit test enforces it).
- **Money.** `BigInt` minor units end to end, serialised as strings across the client boundary;
  FX rates as `Decimal`. The eight money-movement rules of `SPEC.md` are non-negotiable: one DB
  transaction per transfer with row locks in id order, balanced journals per currency, no
  negative wallets, idempotency per sender, AML screening before the debit, reversals as new
  journals, append-only audit, server-side authorisation in every action and route.
- **Honesty.** Operators, KYC vendors, the screening list and FX rates are simulated or
  fictional and must be labelled as such wherever they appear in the UI.
- **Roadmap copies.** `/roadmap` renders `docs/roadmap/schedule.json`; `scripts/sync-roadmap.mjs`
  copies it (and `docs/roadmap/index.html`) into the app before every build. Change dates in
  `docs/` only; never edit the copies by hand.
- **Database + connections.** `DATABASE_URL` is the pooled Neon URL at run time (small `pg`
  pool, no session state, no advisory locks); `DATABASE_URL_UNPOOLED` is used by
  `prisma migrate deploy` and the seed. The seed is idempotent and runs on every deploy.
- **Deploy.** Vercel Git integration, Root Directory `apps/lite`, commands from
  `apps/lite/vercel.json` (`pnpm install --frozen-lockfile --filter @bi-rem/lite...`, then
  `pnpm run vercel-build`). No deploy workflow in `.github/workflows`. Guide:
  `apps/lite/DEPLOY.md`. The `lite` job of `ci.yml` asserts those two commands and rehearses
  them — update the job when you change `vercel.json`.
- **Parallel work.** Use your own database and `NEXT_DIST_DIR=.next-<name>` and port for builds
  and dev servers; `next.config.ts` honours `NEXT_DIST_DIR`.
- **Docs.** When a capability is added or changed, update `apps/lite/SPEC.md`, the phase entry
  in `apps/lite/src/data/lite-phases.ts` and the traceability table in `docs/lite/README.md`.

```bash
createdb -h localhost -U birem birem_lite && cp apps/lite/.env.example apps/lite/.env
pnpm --filter @bi-rem/lite generate && pnpm --filter @bi-rem/lite migrate:deploy
pnpm --filter @bi-rem/lite seed && pnpm --filter @bi-rem/lite dev          # :3002
pnpm --filter @bi-rem/lite lint && pnpm --filter @bi-rem/lite typecheck
pnpm --filter @bi-rem/lite test        # vitest, creates and drops its own databases
pnpm --filter @bi-rem/lite test:e2e    # Playwright on a production build, own database
```

## Commands

```bash
pnpm install
cp .env.example .env
docker compose -f infra/docker/docker-compose.yml up -d   # postgres, redis, mailpit
pnpm db:generate && pnpm db:migrate:dev && pnpm db:seed
pnpm dev                                                   # api:4000 web:3000 admin:3001
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Docs conventions

- Phase docs live at `docs/phases/phase-NN-<key>.md` using the keys in
  `docs/roadmap/schedule.json`; dates in docs MUST match that file.
- Diagrams are Mermaid fenced blocks (` ```mermaid `). Gantt uses Mermaid `gantt`.
- Money figures in USD; estimates given as ranges with stated assumptions.
