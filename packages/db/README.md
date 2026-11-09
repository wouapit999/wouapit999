# @bi-rem/db

Prisma 7 data layer for BI-Rem: schema v1, SQL migrations, idempotent seed, the RBAC
permission catalogue and a `PrismaClient` factory wired to the `pg` driver adapter.

```
packages/db
├── prisma.config.ts            Prisma 7 config (schema path, migrations path, seed, datasource URL)
├── prisma/schema.prisma        Schema v1 (14 models, 7 enums) — snake_case tables/columns via @@map/@map
├── prisma/migrations/          SQL migrations (+ migration_lock.toml, provider postgresql)
├── prisma/seed.ts              Idempotent seed (permissions, system roles, admin, demo customer, templates, flags, settings)
├── prisma/seed-data/           Seed fixtures (notification templates en/fr/pt, feature flags, settings)
├── src/index.ts                createPrismaClient(), re-exports of the generated client, enums and types
├── src/permissions.ts          Re-exports the RBAC catalogue (PERMISSIONS, SYSTEM_ROLES) from @bi-rem/shared
├── generated/client/           Generated client (git-ignored; produced by `pnpm generate`)
└── test/                       Vitest unit tests (no database required)
```

## Usage from other workspaces

```ts
import { createPrismaClient, UserRealm, type User, hasPermission } from '@bi-rem/db';

const db = createPrismaClient(process.env.DATABASE_POOL_URL, { maxConnections: 5 });
const admins = await db.user.findMany({ where: { realm: UserRealm.ADMIN, deletedAt: null } });
```

- `createPrismaClient(url?, options?)` falls back to `process.env.DATABASE_URL`, strips the
  Prisma-style `?schema=` parameter (passed to the adapter as `search_path`) and throws a
  `DatabaseConfigurationError` when no URL is available.
- The generated client is also exposed as `@bi-rem/db/client`, the RBAC catalogue as
  `@bi-rem/db/permissions`.
- Enums are exported both as runtime objects and as types (`UserRealm.ADMIN`, `UserRealm`).

## Generator choice

The schema uses the Prisma 7 `prisma-client` generator (not the legacy `prisma-client-js`):

```prisma
generator client {
  provider               = "prisma-client"
  output                 = "../generated/client"
  runtime                = "nodejs"
  moduleFormat           = "esm"
  generatedFileExtension = "ts"
  importFileExtension    = "js"
}
```

It emits TypeScript (not `.js` + `.d.ts`) into `generated/client/`, so the package compiles
the generated sources together with `src/` (`tsconfig.build.json`) into `dist/`. Consumers
therefore import compiled JavaScript and never need to run `prisma generate` themselves,
and the ESM/NodeNext conventions of the monorepo are respected end to end. Prisma 7 has no
Rust query engine: a driver adapter (`@prisma/adapter-pg`) is mandatory, which is why the
client is always created through `createPrismaClient`.

## Scripts

| Script                                                 | What it does                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| `pnpm --filter @bi-rem/db generate`                    | `prisma generate` → `generated/client/`                              |
| `pnpm --filter @bi-rem/db migrate:dev`                 | Create/apply a migration against the dev database (uses a shadow DB) |
| `pnpm --filter @bi-rem/db migrate:deploy`              | Apply pending migrations (CI / production)                           |
| `pnpm --filter @bi-rem/db migrate:status`              | Show applied vs pending migrations                                   |
| `pnpm --filter @bi-rem/db migrate:reset`               | Drop, recreate, migrate and seed (development only)                  |
| `pnpm --filter @bi-rem/db seed`                        | Run `prisma/seed.ts` with tsx (also wired to `prisma db seed`)       |
| `pnpm --filter @bi-rem/db studio`                      | Prisma Studio                                                        |
| `pnpm --filter @bi-rem/db build`                       | `tsc -p tsconfig.build.json` → `dist/`                               |
| `pnpm --filter @bi-rem/db lint` / `typecheck` / `test` | ESLint flat config, `tsc --noEmit`, Vitest                           |

`build`, `lint`, `typecheck` and `test` require `generate` to have run first (Turbo wires
`^generate` as a dependency; locally run `pnpm --filter @bi-rem/db generate` once).

## Environment variables

| Variable                                         | Used by                                                   | Notes                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                   | CLI (migrate, studio), seed, `createPrismaClient` default | Direct connection. May carry `?schema=public`.                                                           |
| `DIRECT_URL`                                     | CLI only (optional)                                       | When set, `prisma.config.ts` prefers it for migrate/introspection. Point it at the Neon direct endpoint. |
| `DATABASE_POOL_URL`                              | API at runtime                                            | Neon pooled (PgBouncer) endpoint; pass it explicitly to `createPrismaClient`.                            |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`       | seed                                                      | Defaults `admin@bi-rem.local` / `ChangeMe123!`. Password is mandatory when `NODE_ENV=production`.        |
| `SEED_CUSTOMER_EMAIL` / `SEED_CUSTOMER_PASSWORD` | seed                                                      | Demo customer, created only when `NODE_ENV != production`.                                               |

`prisma.config.ts` loads `.env` through `dotenv`. When neither `DIRECT_URL` nor
`DATABASE_URL` is set it falls back to an unresolvable placeholder host so that offline
commands (`validate`, `generate`, `migrate diff --from-empty`) still work while anything that
actually connects fails fast with an obvious `missing-database-url.invalid` error.

## Migration workflow

1. Edit `prisma/schema.prisma` (keep `@@map`/`@map` snake_case, `@db.Uuid` ids with
   `gen_random_uuid()`, `@db.Timestamptz(6)` timestamps; money as `BigInt` minor units + currency).
2. `pnpm --filter @bi-rem/db exec prisma validate && pnpm --filter @bi-rem/db exec prisma format`.
3. With a local Postgres running: `pnpm --filter @bi-rem/db migrate:dev --name <change>`.
   Without a database, generate the SQL offline and review it:
   ```bash
   cd packages/db
   pnpm exec prisma migrate diff --from-migrations prisma/migrations \
     --to-schema prisma/schema.prisma --script > prisma/migrations/$(date -u +%Y%m%d%H%M%S)_<change>/migration.sql
   ```
   (`--from-migrations` needs a shadow database URL; `--from-empty` works fully offline.)
4. Review the SQL by hand. Add data back-fills, `CONCURRENTLY` index builds or `CHECK`
   constraints Prisma cannot express directly in the migration file; never edit an already
   deployed migration.
5. `pnpm --filter @bi-rem/db generate`, then run tests (`test/migration.test.ts` asserts every
   schema v1 table/enum/index is present in the initial migration).
6. Commit schema + migration together. CI runs `migrate deploy` against the target
   environment before the API is rolled out.

The initial migration (`20261116000000_init`) was produced with
`prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` and prefixed with
`CREATE EXTENSION IF NOT EXISTS "citext"` (case-insensitive e-mail) and `"pgcrypto"`
(`gen_random_uuid()` on Postgres < 13).

## Neon notes

- **Two connection strings.** Neon exposes a _direct_ endpoint (`ep-xxx.region.aws.neon.tech`)
  and a _pooled_ one (`ep-xxx-pooler.region.aws.neon.tech`, PgBouncer in transaction mode).
  Use the pooled URL (`DATABASE_POOL_URL`) for the API because serverless/edge instances open
  many short-lived connections. Use the direct URL (`DIRECT_URL` or `DATABASE_URL`) for
  `prisma migrate`, `db seed`, `studio` and anything needing session features (advisory locks,
  `LISTEN/NOTIFY`, prepared statements across transactions). Prisma Migrate acquires an
  advisory lock, which PgBouncer transaction mode does not support.
- **SSL.** Append `?sslmode=require` to both URLs. The `pg` adapter honours it.
- **Pool sizing.** Neon's compute has a connection cap tied to its size; keep
  `maxConnections` per API instance small (≤ 10, often 2-5) and let the pooler multiplex.
- **Cold starts.** Neon autosuspends idle computes; the first query after a pause can take a
  few hundred ms. `createPrismaClient` uses a 10 s connection timeout for that reason.
- **Branching for preview environments.** Create a Neon branch per pull request
  (`neonctl branches create --name preview-<pr>` or the Neon GitHub integration), which
  copies the parent schema and data instantly (copy-on-write). The preview deploy then runs
  `pnpm --filter @bi-rem/db migrate:deploy` and `seed` against that branch's URLs and the
  branch is deleted when the PR closes. Production migrations should be rehearsed on a branch
  of `main` before `migrate deploy` runs against the primary branch.
- **Extensions.** `citext` and `pgcrypto` are available on Neon without extra configuration;
  the initial migration enables them with `CREATE EXTENSION IF NOT EXISTS`.

## Seed behaviour

`prisma/seed.ts` is safe to run on every deploy:

- Permissions and system roles are upserted; each system role's grant set is reconciled
  against `src/permissions.ts` (grants are added **and** removed), so the code is authoritative.
- The admin user (realm `ADMIN`, role `SUPER_ADMIN`) is created once; an existing user's
  password is never overwritten. The hash is Argon2id (19 MiB, t=2, p=1), matching the API.
- A demo customer (realm `CUSTOMER`, role `CUSTOMER`) is created only outside production.
- Notification templates (`welcome`, `password-reset`, `login-alert`, `mfa-code` × EMAIL/SMS ×
  en/fr/pt) are created once; only their `variables` list is refreshed so operator edits to
  copy survive re-seeding. Feature flag and setting _values_ are likewise preserved; only
  descriptions are refreshed.

## Tests

`pnpm --filter @bi-rem/db test` runs without a database:

- `test/permissions.test.ts` — catalogue shape, no duplicates, every system role references
  only known permissions, privilege boundaries, wildcard matching.
- `test/migration.test.ts` — the initial migration contains every schema v1 table, enum,
  required index, uuid/timestamptz conventions and the extension statements.
- `test/client.test.ts` — URL resolution, configuration errors, client construction (no
  connection is opened), enum re-exports.
