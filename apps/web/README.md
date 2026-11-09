# @bi-rem/web — customer portal

Next.js 16 (App Router, React 19) customer portal for BI-Rem. Port **3000**.

## What is here

| Area               | Path                                                               | Notes                                                                                 |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Marketing landing  | `src/app/(public)/page.tsx`                                        | Product summary + supported countries from `@bi-rem/shared` constants                 |
| Auth pages         | `src/app/(public)/{login,register,forgot-password,reset-password}` | react-hook-form + `@hookform/resolvers` over shared zod schemas                       |
| Authenticated area | `src/app/(dashboard)/{dashboard,profile,notifications,security}`   | Sidebar/topbar shell, KYC + Send money/Wallets placeholders                           |
| Auth BFF           | `src/app/api/auth/*`                                               | Route handlers that call the API and set **httpOnly** cookies                         |
| Data proxy         | `src/app/api/proxy/[...path]`                                      | Forwards `/api/proxy/v1/...` to the API with the access-token cookie                  |
| Edge guard         | `src/proxy.ts`                                                     | Next 16 `proxy` (formerly middleware) protecting dashboard routes                     |
| API client         | `src/lib/api.ts`                                                   | Typed fetch wrapper: bearer token, refresh-once on 401, RFC 9457 → `ApiError`         |
| i18n               | `src/i18n/`                                                        | `en`, `fr`, `pt` catalogues, `I18nProvider`/`useT`, cookie-based locale switcher      |
| Env                | `src/env.ts`                                                       | Zod validation of `NEXT_PUBLIC_*` (imported by `next.config.ts`, so it runs at build) |

## Auth model

```
browser ──POST /api/auth/login──▶ route handler ──POST /v1/auth/login──▶ API
        ◀── Set-Cookie: birem_access (httpOnly, path=/)
            Set-Cookie: birem_refresh (httpOnly, path=/api/auth)

browser ──GET /api/proxy/v1/users/me (cookie)──▶ proxy handler ──Bearer──▶ API
        ◀── 401? browser client POSTs /api/auth/refresh once, then retries
```

- The browser never sees either token. The refresh token is path-scoped to `/api/auth`, so it is
  only transmitted to the handlers that rotate it.
- `src/proxy.ts` redirects unauthenticated visits to `/api/auth/refresh?next=…`, which either
  rotates the session or lands on `/login?next=…`. The dashboard layout validates the access token
  against `GET /v1/auth/me` and performs the same bounce when it has expired.
- Login always uses `realm: 'CUSTOMER'`. MFA challenges are rejected with `MFA_REQUIRED` until the
  portal implements the second step.

## API contract

Paths live in `src/lib/routes.ts` (`API`) and are built on `@bi-rem/shared` `API_ROUTES`, which
match the NestJS controllers: password reset uses `/v1/auth/password/reset/request` and
`/v1/auth/password/reset/confirm`; the self-service notification endpoints are
`GET /v1/notifications/me` and `POST /v1/notifications/me/:id/read`.

Two response shapes are deliberately tolerated on the web side (`src/lib/auth-schemas.ts`
`sessionUserSchema`, `src/lib/notifications.ts`): `GET /v1/auth/me` omits `updatedAt` and adds
`permissions`, and `GET /v1/notifications/me` returns the stored row (`payload.subject/body`, no
`category`). Both are normalised before they reach components.

### Request hardening

- Every mutating BFF route and the data proxy require `application/json` and reject
  `Sec-Fetch-Site: cross-site`, which rules out form-based CSRF without a token
  (`src/lib/server/handlers.ts` `rejectCrossSiteRequest`).
- The proxy validates and re-encodes each path segment (`src/lib/server/proxy-path.ts`): only
  `/v1/*` is reachable and the session endpoints must go through `/api/auth/*`.

## Scripts

```bash
pnpm --filter @bi-rem/web dev        # http://localhost:3000
pnpm --filter @bi-rem/web lint
pnpm --filter @bi-rem/web typecheck
pnpm --filter @bi-rem/web test
pnpm --filter @bi-rem/web build      # output: standalone, no API needed at build time
```

`@bi-rem/shared` must be built first (`pnpm --filter @bi-rem/shared build`); Turborepo does that
automatically via `dependsOn: ["^build"]`.

## Environment

See `.env.example`. `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_APP_NAME` are validated at build time;
`API_INTERNAL_URL` lets server-side handlers reach the API over an internal network.

## Styling

Tailwind CSS 4 with design tokens declared in `src/app/globals.css` (`@theme`): brand deep green
`#0B6E4F`, gold `#F2B705`, slate neutrals. Semantic tokens (`bg-surface`, `text-fg`, `border-border`)
flip automatically with `prefers-color-scheme: dark`.

## Deployment

`vercel.json` sets the framework and pnpm install/build commands; set the project root directory to
`apps/web` in Vercel. The Docker image is produced by `infra/`.
