# @bi-rem/admin — admin portal

Next.js 16 (App Router, React 19, Tailwind 4, TanStack Query 5, zod 4) back-office for BI-Rem.
Port **3001**. Phase 1 scope: identity & access, audit, notification templates, platform settings.

## What is here

| Area           | Path                                                     | Notes                                                                                     |
| -------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Sign-in        | `src/app/login`                                          | react-hook-form + zod; posts to the BFF, never to the API directly                        |
| Protected area | `src/app/(app)/*`                                        | Layout resolves the session server-side and renders the shell                             |
| Dashboard      | `src/app/(app)/dashboard`                                | Server-probed `GET /health`, live counts, greyed Phase 2+ tiles                           |
| Users          | `src/app/(app)/users`, `users/[id]`                      | Search/filter/pagination in the URL, suspend/reactivate, roles + permission preview       |
| Roles          | `src/app/(app)/roles`                                    | Create/edit with a resource × action permission matrix, delete non-system roles           |
| Audit log      | `src/app/(app)/audit`                                    | Filterable log; expanding a row shows a before/after JSON diff and request metadata       |
| Templates      | `src/app/(app)/notifications/templates`                  | Per key/channel/locale editing with placeholder/variable hints                            |
| Settings       | `src/app/(app)/settings`                                 | Feature flags (toggle + rollout %), key/value settings with secret masking, API keys      |
| Auth BFF       | `src/app/api/auth/{login,refresh,logout}`                | Route handlers that call the API and set **httpOnly** cookies                             |
| Data proxy     | `src/app/api/proxy/[...path]`                            | Forwards `/api/proxy/v1/...` to the API with the access-token cookie                      |
| Edge guard     | `src/proxy.ts`                                           | Next 16 `proxy` (formerly middleware) protecting the `(app)` routes                       |
| API client     | `src/lib/api.ts`                                         | `ApiClient` (bearer, refresh-once on 401, RFC 9457 → `ApiError`) + typed `createAdminApi` |
| Permissions    | `src/lib/permissions.ts`, `src/components/shell/can.tsx` | Pure helpers + `useCan`/`<Can>`/`<PermissionGate>` for the permission-aware UI            |
| JSON diff      | `src/lib/json-diff.ts`                                   | Structural diff used by the audit viewer                                                  |
| Env            | `src/env.ts`                                             | Zod validation of `NEXT_PUBLIC_*` (imported by `next.config.ts`, so it runs at build)     |

## Auth model

```
browser ──POST /api/auth/login──▶ route handler ──POST /v1/auth/admin/login──▶ API
        ◀── Set-Cookie: birem_admin_access  (httpOnly, path=/)
            Set-Cookie: birem_admin_refresh (httpOnly, path=/api/auth)

browser ──GET /api/proxy/v1/users (cookie)──▶ proxy handler ──Bearer──▶ API
        ◀── 401? browser client POSTs /api/auth/refresh once, then retries
```

- The browser never sees either token. The refresh token is path-scoped to `/api/auth`, so it is
  only transmitted to the handlers that rotate it. Cookie names carry an `admin_` segment so an
  admin session never collides with a customer-portal session on a shared parent domain.
- `src/proxy.ts` redirects unauthenticated visits to `/api/auth/refresh?next=…`, which either
  rotates the session or lands on `/login?next=…`. The `(app)` layout validates the access token
  against `GET /v1/auth/me`, rejects non-`ADMIN` realms, and performs the same bounce when expired.
- MFA challenges are answered with `MFA_REQUIRED` (403) until the portal implements the second
  step; the challenge token is never persisted.
- Logout always clears both cookies and revokes the refresh token on the API. Because
  `POST /v1/auth/logout` needs a valid bearer, an expired access token is first exchanged through
  `POST /v1/auth/refresh` so the (rotated) refresh token can still be revoked.

## Permission-aware UI

`GET /v1/auth/me` returns the admin's roles and effective `permissions[]`. `SessionProvider`
exposes `can`, `canAny`, `canAccess(section)`; the sidebar and command palette only list sections
the admin may open, pages render `ForbiddenState` otherwise, and write actions (create, suspend,
edit, delete, toggle) are hidden or disabled without the matching `resource:write` permission.
Permission strings come from `@bi-rem/shared` (`PERMISSIONS`) plus `API_ONLY_PERMISSIONS` for the
codes the API guards with but the shared list lacks; `SECTION_PERMISSIONS` in
`src/lib/permissions.ts` maps sections to the read permission(s) that unlock them. Write actions
use the exact permission the API checks (`users:suspend`, `roles:delete`, `api-keys:revoke`, …).

## API contract

Paths live in `src/lib/routes.ts` (`API`), built on `@bi-rem/shared` `API_ROUTES`. The NestJS API
(`apps/api`) is the source of truth: it validates bodies and query strings with
`forbidNonWhitelisted`, so every name below is exactly what its DTOs accept.

| Endpoint                                                                                             | Used by                                            |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `POST /v1/auth/admin/login` → `{ accessToken, refreshToken, tokenType, expiresIn }` or MFA challenge | login route handler (`{ email, password }`)        |
| `POST /v1/auth/refresh`, `POST /v1/auth/logout` (bearer + `{ refreshToken, allDevices }`)            | session handling                                   |
| `GET /v1/auth/me` → profile + `roles[]` + `permissions[]` (no `updatedAt`)                           | `(app)` layout, `SessionProvider`                  |
| `GET /v1/users?page&pageSize&search&realm&status`, `GET/PATCH /v1/users/:id`, `POST /v1/users`       | users (`AdminCreateUserDto`: no `status` field)    |
| `POST /v1/users/:id/suspend`, `POST /v1/users/:id/reactivate` — both `{ reason }`, `users:suspend`   | status actions                                     |
| `PUT /v1/users/:id/roles` (`{ roleIds }`) → `{ userId, roles[] }`                                    | role assignment (detail is refetched afterwards)   |
| `GET/POST/PATCH/DELETE /v1/roles` (`roles:delete` to delete), `GET /v1/permissions` → `{ id, key }`  | roles + matrix                                     |
| `GET /v1/audit?actorId&resource&resourceId&action&from&to&page&pageSize`                             | audit log (`resource` is PascalCase, e.g. `User`)  |
| `GET /v1/feature-flags`, `PUT /v1/feature-flags/:key` (`{ enabled, rolloutPercentage, rules }`)      | flags (full replacement; the panel merges the row) |
| `GET /v1/settings`, `PUT /v1/settings/:key` (`{ value, description?, isSecret }`)                    | key/value settings                                 |
| `GET/POST /v1/api-keys` (`{ name, scopes[], expiresAt? }` → view + one-time `key`), `DELETE /:id`    | API keys (`api-keys:revoke` to revoke)             |
| `GET/PUT /v1/notifications/templates` (`{ key, channel, locale, subject?, body, variables }`)        | templates (no category/version on the API row)     |
| `GET /health`                                                                                        | dashboard probe (server-side, with timeout)        |

Response bodies are validated with zod before they reach the UI. Shared schemas are used where
they match the API (`roleSchema`-compatible roles, pagination meta, problem details). Where the
shared package's draft read models diverge from the API's view models, the exact wire shapes
live in `src/lib/schemas.ts` with a comment naming the API type they mirror; `schemas.test.ts`
pins them with fixtures copied from those view models. Known divergences from `@bi-rem/shared`:

- `GET /v1/auth/me` has no `updatedAt`; audit rows have `actorType`/`metadata` instead of
  `apiKeyId`; the permission catalogue is `{ id | null, key, description }`.
- Feature flags are `{ enabled, rolloutPercentage, rules[], description }` (no realms/allow-list);
  settings and flags have no `updatedBy`; templates have no `category`/`version`.
- API keys use `scopes` (incl. `resource:*` / `*`) and `createdById`; creation returns the view
  with the plaintext in `key`.
- The API seeds users with `countryCode: "SN"`, which `COUNTRY_CODES` does not list, so profile
  read models accept any 2–3 letter code and the UI shows unknown codes verbatim.
- The API guards some endpoints with permissions missing from the shared `PERMISSIONS` constant
  (`users:suspend`, `roles:delete`, `api-keys:revoke`, …); `API_ONLY_PERMISSIONS` in
  `src/lib/permissions.ts` lists the ones the portal checks.

## Scripts

```bash
pnpm --filter @bi-rem/admin dev        # http://localhost:3001
pnpm --filter @bi-rem/admin lint
pnpm --filter @bi-rem/admin typecheck
pnpm --filter @bi-rem/admin test       # vitest: wire schemas, api client (refresh-once), permissions, json diff, routes
pnpm --filter @bi-rem/admin build      # output: standalone, no API needed at build time
```

`@bi-rem/shared` must be built first (`pnpm --filter @bi-rem/shared build`); Turborepo does that
automatically via `dependsOn: ["^build"]`.

## Environment

See `.env.example`. `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_NAME` and `NEXT_PUBLIC_ENV`
(`sandbox` | `production`, shown as the topbar badge) are validated at build time. Server-only:
`API_INTERNAL_URL` (internal API hostname for route handlers), `AUTH_COOKIE_SECURE`,
`HEALTH_TIMEOUT_MS`.

## Design

Brand tokens (deep green `#0B6E4F`, gold `#F2B705`, slate neutrals) are defined once in
`src/app/globals.css` as semantic CSS variables (`surface`, `fg`, `accent`, …). Dark mode follows
`prefers-color-scheme` and can be forced with the topbar toggle (`data-theme`, persisted in
`localStorage`, applied before paint by an inline script). Tables carry captions, forms expose
`aria-invalid`/`aria-describedby`, dialogs use the native `<dialog>` element, and the command
palette (`⌘K` / `Ctrl+K`) is a combobox/listbox pair.

## Deployment

`vercel.json` builds `@bi-rem/shared` then this app; `next.config.ts` emits a standalone server,
disables `x-powered-by`, and sets CSP, HSTS, frame, referrer, permissions and `X-Robots-Tag:
noindex` headers. Point `NEXT_PUBLIC_API_URL` (browser) and `API_INTERNAL_URL` (server) at the API.
