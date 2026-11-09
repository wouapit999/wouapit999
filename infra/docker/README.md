# infra/docker

Local stack and production container images for BI-Rem.

| File                                  | Purpose                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`                  | Local backing services (`postgres:17`, `redis:7`, Mailpit) plus an optional `apps` profile that builds and runs api/web/admin from the Dockerfiles below. |
| `postgres/init.sql`                   | First-boot script: enables `citext` + `pgcrypto`, creates `birem_test` and `birem_shadow`.                                                                |
| `api.Dockerfile`                      | NestJS API image (turbo prune, pnpm, multi-stage, non-root, tini, Prisma CLI for migrations).                                                             |
| `web.Dockerfile` / `admin.Dockerfile` | Next.js 16 `standalone` images for the two portals.                                                                                                       |
| `api-entrypoint.sh`                   | `start` (optionally migrate first when `RUN_MIGRATIONS=true`), `migrate`, or an arbitrary command.                                                        |
| `prisma.config.ts`                    | Dependency-free runtime copy of `packages/db/prisma.config.ts` used by `prisma migrate deploy` inside the image.                                          |

## Local development

```bash
docker compose -f infra/docker/docker-compose.yml up -d        # or: infra/scripts/bootstrap.sh
docker compose -f infra/docker/docker-compose.yml ps
docker compose -f infra/docker/docker-compose.yml logs -f postgres
docker compose -f infra/docker/docker-compose.yml down -v       # wipe volumes
```

Ports (override with `POSTGRES_PORT`, `REDIS_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`):
Postgres `5432`, Redis `6379`, Mailpit SMTP `1025`, Mailpit UI <http://localhost:8025>.

## Running the application images locally

```bash
GIT_SHA=$(git rev-parse --short HEAD) \
  docker compose -f infra/docker/docker-compose.yml --profile apps up --build
```

The API container applies migrations on start (`RUN_MIGRATIONS=true`), then listens on
`:4000`; web on `:3000`, admin on `:3001`. Seeding is not bundled in the image: run
`pnpm db:seed` from a checkout against the same `DATABASE_URL`.

## Building images by hand

```bash
docker build -f infra/docker/api.Dockerfile   -t birem/api   --build-arg GIT_SHA=$(git rev-parse HEAD) .
docker build -f infra/docker/web.Dockerfile   -t birem/web   --build-arg NEXT_PUBLIC_API_URL=https://api.staging.example.com .
docker build -f infra/docker/admin.Dockerfile -t birem/admin --build-arg NEXT_PUBLIC_API_URL=https://api.staging.example.com --build-arg NEXT_PUBLIC_ENV=sandbox .
```

Lint only (no build): `docker build --check -f infra/docker/api.Dockerfile .`

### Design notes

- **turbo prune** keeps only the target app and its workspace dependencies in the build
  context of the `installer` stage, so a change in `apps/web` does not bust the API's
  dependency layer.
- **Production dependencies** are re-resolved with `pnpm install --prod` after the build, so
  the runtime image has no compilers, test runners or Nest CLI.
- **Migrations** run with the globally installed `prisma@7.10.1` CLI (pinned to the workspace
  version) against `/app/prisma/prisma.config.ts`; the image never contains `tsx` or the
  TypeScript seed.
- Images run as uid/gid `1001` (`birem`), use `tini` as PID 1 and declare a `HEALTHCHECK`
  (`/health/live` for the API, `/` for the portals).
- `NEXT_PUBLIC_*` values are build arguments because Next.js inlines them: build one portal
  image per environment (or deploy the portals on Vercel, see `infra/vercel/README.md`).
