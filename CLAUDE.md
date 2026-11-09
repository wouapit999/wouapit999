# BI-Rem — contributor & agent conventions

BI-Rem is a pan-African remittance / mobile-money platform built in 13 independently
deployable phases (see `docs/`). This repository holds the Phase 1 foundation code and the
full planning documentation for every phase.

## Repository layout (pnpm workspaces + Turborepo)

| Path | Package name | Purpose |
|------|--------------|---------|
| `apps/api` | `@bi-rem/api` | NestJS 12 backend (REST + OpenAPI). Port 4000. |
| `apps/web` | `@bi-rem/web` | Next.js 16 **customer portal**. Port 3000. |
| `apps/admin` | `@bi-rem/admin` | Next.js 16 **admin portal**. Port 3001. |
| `packages/db` | `@bi-rem/db` | Prisma 7 schema v1, migrations, seed, exported `PrismaClient`. |
| `packages/shared` | `@bi-rem/shared` | Zod schemas, DTO types, enums, constants shared by api/web/admin. |
| `packages/config` | `@bi-rem/config` | Shared `tsconfig` and ESLint presets. |
| `infra/` | — | Docker, docker-compose, deploy scripts, fly.toml, Vercel config. |
| `.github/workflows` | — | CI/CD pipelines. |
| `docs/` | — | Roadmap, per-phase plans, architecture, handbooks. |

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
