# Deploying the portals to Vercel

`apps/web` (customer portal, `@bi-rem/web`) and `apps/admin` (admin portal, `@bi-rem/admin`)
are two separate Vercel projects linked to the same GitHub repository. Each project's
**Root Directory** points at its app folder; Vercel detects the pnpm workspace from the repo
root and uses the committed `apps/<app>/vercel.json`.

## Project settings

| Setting                              | `bi-rem-web`                                                            | `bi-rem-admin`                                                     |
| ------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Framework preset                     | Next.js                                                                 | Next.js                                                            |
| Root Directory                       | `apps/web`                                                              | `apps/admin`                                                       |
| Include files outside root directory | enabled (monorepo)                                                      | enabled                                                            |
| Node.js version                      | 22.x                                                                    | 22.x                                                               |
| Install Command                      | `pnpm install --frozen-lockfile` (from `vercel.json`)                   | same                                                               |
| Build Command                        | `pnpm --filter @bi-rem/shared build && pnpm --filter @bi-rem/web build` | `... @bi-rem/admin build`                                          |
| Output Directory                     | `.next`                                                                 | `.next`                                                            |
| Ignored Build Step                   | `npx turbo-ignore @bi-rem/web`                                          | `npx turbo-ignore @bi-rem/admin`                                   |
| Region                               | `cdg1` (Paris)                                                          | `cdg1`                                                             |
| Production branch                    | `main`                                                                  | `main`                                                             |
| Deployment protection                | off (public portal)                                                     | Vercel Authentication on previews; production behind the app login |

`turbo-ignore` compares the workspace's dependency graph (`@bi-rem/shared`, `@bi-rem/config`,
root config) between the previous successful deployment and the current commit and exits
`0` (skip build) when nothing relevant changed. Changes to `apps/api` or `packages/db` do not
redeploy the portals.

## Environment variable matrix

Vercel has three scopes: **Production** (`main`), **Preview** (every other branch / PR) and
**Development** (`vercel env pull`). Add them in Project Settings → Environment Variables or
with `vercel env add <NAME> <scope>`.

| Variable                         | Preview                                | Production                                                  | Notes                                                     |
| -------------------------------- | -------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`            | `https://api.staging.bi-rem.africa`    | `https://api.bi-rem.africa`                                 | Build-time, inlined. Must match the API's `CORS_ORIGINS`. |
| `NEXT_PUBLIC_APP_NAME`           | `BI-Rem (preview)`                     | `BI-Rem`                                                    |                                                           |
| `NEXT_PUBLIC_APP_URL`            | leave unset (Vercel sets `VERCEL_URL`) | `https://app.bi-rem.africa` / `https://admin.bi-rem.africa` | Absolute links in metadata.                               |
| `NEXT_PUBLIC_ENV` (admin only)   | `sandbox`                              | `production`                                                | Topbar badge.                                             |
| `API_INTERNAL_URL`               | unset                                  | unset (or private API hostname)                             | Server-only; route handlers call the API with it.         |
| `AUTH_COOKIE_SECURE`             | `true`                                 | `true`                                                      | Server-only.                                              |
| `HEALTH_TIMEOUT_MS` (admin only) | `3000`                                 | `3000`                                                      | Server-only.                                              |
| `TURBO_TOKEN` / `TURBO_TEAM`     | optional                               | optional                                                    | Remote cache for `turbo-ignore` + builds.                 |

Preview deployments talk to the **staging** API; the staging API must list
`https://*.vercel.app` preview origins in `CORS_ORIGINS` (or use the stable preview alias
`https://bi-rem-web-git-<branch>-<team>.vercel.app` per branch). Secrets never belong in
`NEXT_PUBLIC_*`.

## Neon branch per preview

Previews do not need their own database because the portals only talk to the API. When a
feature needs an isolated schema end-to-end:

1. Install the [Neon GitHub integration](https://neon.tech/docs/guides/neon-github-integration)
   on the repository; it creates `NEON_API_KEY` and `NEON_PROJECT_ID` repository secrets.
2. Add `neondatabase/create-branch-action` + `neondatabase/delete-branch-action` steps to
   `.github/workflows/deploy-api.yml` (PR scope) to create `preview/pr-<n>` from `main`,
   run `pnpm db:migrate` against it and deploy a Fly preview app (`fly apps create
bi-rem-api-pr-<n>`), then set the preview's `NEXT_PUBLIC_API_URL` with
   `vercel env add NEXT_PUBLIC_API_URL preview <branch>`.
3. Delete the Neon branch and the Fly app when the PR closes.

Neon branches are copy-on-write, so each preview carries production-like data at near-zero
cost; expire them with `--expires` (Neon API) to avoid orphaned branches.

## CLI deploys (used by `.github/workflows/deploy-web.yml` / `deploy-admin.yml`)

```bash
cd apps/web
vercel pull --yes --environment=preview --token "$VERCEL_TOKEN"
vercel build --token "$VERCEL_TOKEN"
vercel deploy --prebuilt --token "$VERCEL_TOKEN"
```

Required secrets per GitHub Environment (`preview`, `production`): `VERCEL_TOKEN`
(team-scoped token), `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_WEB`, `VERCEL_PROJECT_ID_ADMIN`
(from `.vercel/project.json` after `vercel link`). The workflows export
`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` so no `.vercel` folder is needed in the repo.

### Alternative: Vercel Git integration

Connecting the repository directly in Vercel gives the same preview/production behaviour
with zero workflow code, including PR comments and instant rollbacks from the dashboard.
Choose one: if the Git integration is enabled, disable the two deploy workflows (or set
`VERCEL_GIT_INTEGRATION=true` as a repository variable, which makes them skip) to avoid
double deployments. The CLI route is kept because it lets CI gate deploys on the full
`ci.yml` result and keeps all deployment logic in version control.

## Rollback

Dashboard → Deployments → previous deployment → **Promote to Production**, or
`vercel rollback <deployment-url> --token "$VERCEL_TOKEN"`.
