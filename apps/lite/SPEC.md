# BI-Rem Lite — specification

BI-Rem Lite is a **small-scale, single-deployable web application** that reflects the whole
BI-Rem programme (all 13 phases of `docs/`) end to end, deployable today with nothing but a
GitHub repository, one Vercel project and one Neon database. It sits alongside the Phase 1
foundation (`apps/api`, `apps/web`, `apps/admin`) and the roadmap (`docs/`), which stay as they are.

It is a working product in miniature, not a mock-up: real auth, real database, real double-entry
money movement between wallets. The only simulated part is the outside world — mobile-money
operators and KYC vendors — which sits behind the same interfaces the full platform will use.

## Stack and constraints

- Workspace `apps/lite`, package `@bi-rem/lite`, dev port **3002**. Self-contained: it does NOT
  depend on `@bi-rem/db`, `@bi-rem/shared` or `apps/api` (own Prisma schema, own database).
- Next.js `^16` App Router, React `^19`, Tailwind CSS `^4`, TypeScript `^5.9`, Zod `^4`.
  Server Components + Server Actions for the UI, Route Handlers for `/api/**`. Node runtime only.
- Prisma `^7.10` + `@prisma/adapter-pg` + `pg`. Schema at `apps/lite/prisma/schema.prisma`,
  generated client at `apps/lite/src/generated/prisma` (git-ignored), `prisma.config.ts`.
- No Redis, no queues, no object storage, no external services. Everything fits Vercel Hobby +
  Neon Free. Background work is done inline inside the request.
- Password hashing with Node `crypto.scrypt` (no native modules). Sessions are a signed JWT
  (`jose`, HS256) in an httpOnly, SameSite=Lax, Secure-in-production cookie `birem_session`.
- Money: `BigInt` minor units + ISO-4217 currency, never floats. FX rates as `Decimal`.
  Currency exponents: XAF 0, XOF 0, AOA 2, MZN 2, CVE 2, STN 2, NGN 2, GHS 2, KES 2, UGX 0,
  TZS 2, RWF 0, ZAR 2, USD 2, EUR 2.
- IDs are uuid; timestamps timestamptz; snake_case table/column names via `@@map`/`@map`.
- `next.config.ts` must honour `distDir: process.env.NEXT_DIST_DIR ?? '.next'` so several
  builds/dev servers can run side by side.

## Environment variables (validated with Zod in `src/server/env.ts`)

| Var                                        | Purpose                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                             | Runtime connection (Neon **pooled** URL on Vercel).                                                                |
| `DATABASE_URL_UNPOOLED`                    | Direct URL for migrations/seed (Vercel–Neon integration sets it). Falls back to `DATABASE_URL`.                    |
| `AUTH_SECRET`                              | ≥ 32 chars, signs sessions. Required in production.                                                                |
| `ENCRYPTION_KEY`                           | 32 bytes base64, AES-256-GCM for provider credentials, webhook and MFA secrets. Required in production.            |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Initial admin (defaults `admin@bi-rem.local` / `ChangeMe123!`; password mandatory in production).                  |
| `SEED_DEMO_DATA`                           | `true` seeds demo customers, wallets, transfers (default true outside production, false in production unless set). |
| `NEXT_PUBLIC_APP_NAME`                     | Defaults to `BI-Rem Lite`.                                                                                         |

In development, missing `AUTH_SECRET`/`ENCRYPTION_KEY` fall back to fixed dev values with a warning.

## Vercel build

`apps/lite/vercel.json`: framework nextjs, `installCommand` =
`pnpm install --frozen-lockfile --filter @bi-rem/lite...` and `buildCommand` = `pnpm run vercel-build`.
`vercel-build` = `prisma generate && prisma migrate deploy && tsx prisma/seed.ts && next build`.
The seed is idempotent (upserts) so every deploy is safe. Vercel project root directory = `apps/lite`.

## How each programme phase appears in Lite

| #   | Phase              | Lite implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Foundation         | Auth (register/login/logout, scrypt, lockout after 5 failures), roles `CUSTOMER`, `ADMIN`, `COMPLIANCE`, `TREASURY`, `SUPPORT`, `PARTNER` with a permission map, append-only audit log on every mutation, in-app notifications, `/api/health`, `/status` page.                                                                                                                                                                                                                                                         |
| 2   | Customer & KYC     | Registration, optional TOTP MFA, profile, KYC case (ID type/number/country + document upload ≤ 1 MB stored as `bytea` with sha256), simulated vendors (Veriff / Sumsub / Smile Identity) behind a `KycProvider` interface, KYC tiers with limits, beneficiaries, risk profile (score + level), admin verification queue, customer search.                                                                                                                                                                              |
| 3   | Connectivity       | Provider directory in the database; admin configures base URL, credentials (encrypted, never returned after save), webhook secret, callback URL, environment (sandbox/production), status; connectivity test and health history from the dashboard; secret rotation with versioning. No credential in code.                                                                                                                                                                                                            |
| 4   | Wallet connectors  | One `WalletConnector` interface (`validateAccount`, `getBalance`, `transfer`, `getStatus`, `reverse`, `getStatement`); adapter registry; a deterministic `SimulatorConnector` used for sandbox for MTN MoMo, Orange Money, Airtel Money, Moov Money, M-Pesa, Unitel Money, e-Mola; a generic `HttpConnector` for production endpoints (config-driven, clearly marked untested against real operators); signed inbound webhook endpoint with replay protection; idempotency keys. Adding a provider = one database row. |
| 5   | Domestic transfers | Wallet→wallet, wallet→merchant, wallet→agent inside one country/currency; configurable fee rules (fixed + bps, min/max, cap); double-entry ledger; limits per KYC tier; history, tracking timeline, receipt (HTML print + PDF), notifications, audit trail.                                                                                                                                                                                                                                                            |
| 6   | International      | Corridors between CEMAC (CM, GA, TD, CG, CF, GQ — XAF), AO (AOA), MZ (MZN), CV (CVE), GW (XOF), ST (STN); quote with locked rate (15-minute validity), cross-currency + cross-network execution, purpose of transfer and source of funds, reconciliation view.                                                                                                                                                                                                                                                         |
| 7   | FX & treasury      | FX rate table (mid rate, source, margin bps per pair), manual override with audit, treasury dashboard (settlement/float accounts per currency with low-liquidity thresholds and alerts), profit analytics (fees + FX margin by day/corridor).                                                                                                                                                                                                                                                                          |
| 8   | AML & fraud        | Rule engine (amount threshold, velocity count/value, structuring, new-account high value, high-risk corridor), sanctions/PEP name screening (fuzzy match on a seeded demo list — demo data, not a real list), risk score, automatic hold of flagged transfers, alerts → cases, case notes, release/reject, SAR workflow (draft → filed with reference).                                                                                                                                                                |
| 9   | Partner & merchant | Partner/merchant/agent onboarding by admin and self-serve application, partner dashboard, commission rules (bps) accrued per transfer, settlements, API keys (shown once, hashed), webhook endpoints (signed deliveries logged), public REST API `/api/v1/*` authenticated by API key.                                                                                                                                                                                                                                 |
| 10  | Reporting & BI     | Executive, operational, revenue, compliance and treasury dashboards computed live from Postgres; KPIs: volume, value, revenue, failed transactions, provider performance, country activity, FX profitability, active users (DAU/MAU); exports CSV, Excel (`exceljs`) and PDF (`pdf-lib`).                                                                                                                                                                                                                              |
| 11  | Mobile             | Mobile-first responsive UI and an installable PWA (manifest, icons, theme colour). Native React Native apps remain a roadmap item — say so in the UI.                                                                                                                                                                                                                                                                                                                                                                  |
| 12  | Go-live            | Health endpoint with database check, public status page, security headers (CSP, HSTS, frame-ancestors), rate limiting on auth (database-backed), CI job, deploy guide and go-live checklist link.                                                                                                                                                                                                                                                                                                                      |
| 13  | Expansion          | Country registry with `enabled` flag; NG, GH, KE, UG, TZ, RW, ZA seeded as planned (disabled) and switchable by admin; rails registry lists Visa Direct, Mastercard Send, TerraPay, Onafriq, Flutterwave, Paystack, ISO 20022, SWIFT, SEPA as planned connectors.                                                                                                                                                                                                                                                      |

A public **`/roadmap`** page renders the programme from `docs/roadmap/schedule.json` (copied into
the app at build time or imported as JSON): the 13 phases with dates, status and, for each, what
Lite already implements. It links to the full interactive roadmap, which is served as a static
file at `/roadmap-full.html` (copy of `docs/roadmap/index.html` placed in `public/`).

## Money movement rules (non-negotiable)

1. Every transfer runs in **one database transaction** with row locks (`SELECT … FOR UPDATE`) on
   the ledger accounts involved, taken in a stable order (sorted by id) to avoid deadlocks.
2. Every journal is balanced per currency: sum(debits) = sum(credits). A cross-currency transfer
   posts two balanced legs through per-currency FX position/settlement accounts.
3. Balances never go negative for customer/merchant/agent wallets; system accounts may.
4. `idempotencyKey` is unique per sender; a replay returns the original transfer, never a second debit.
5. Fees and FX margin are posted to revenue accounts in the same transaction; partner commission
   accrues in the same transaction.
6. AML screening runs before the debit; a flagged transfer is created `ON_HOLD` with funds
   reserved (moved to a suspense account), and compliance releases (completes) or rejects (refunds).
7. A reversal is a new compensating journal, never an edit or delete. Audit rows are append-only.
8. Authorisation is checked server-side in every action and route handler; a customer can only
   ever read or move their own wallets, beneficiaries, transfers and documents.

## Suggested layout

```
apps/lite/
  prisma/{schema.prisma,migrations/,seed.ts}
  src/app/                (public)  /, /login, /register, /roadmap, /status
  src/app/app/**          customer area
  src/app/admin/**        back office (admin, compliance, treasury, support)
  src/app/partner/**      partner / merchant / agent portal
  src/app/api/**          health, v1 public API, provider webhooks, exports
  src/server/**           domain services (auth, rbac, audit, ledger, transfers, fees, fx,
                          connectors, kyc, aml, partners, reports, notifications, crypto, env, db)
  src/components/**       shared UI kit
  tests/                  vitest unit + integration (real Postgres), e2e (Playwright)
```

## Seeded demo accounts (non-production, or when `SEED_DEMO_DATA=true`)

`admin@bi-rem.local` (ADMIN), `compliance@bi-rem.local`, `treasury@bi-rem.local`,
`support@bi-rem.local`, `partner@bi-rem.local` (PARTNER, linked to a demo merchant), and customers
`amina@example.com` (CM, verified, funded XAF wallet), `joao@example.com` (AO, verified, AOA),
`maria@example.com` (MZ, pending KYC). Demo password for all: `ChangeMe123!`.

## Brand

Deep green `#0B6E4F`, gold `#F2B705`, slate neutrals, system font stack, light and dark mode.
Languages: English UI; keep strings ready for fr/pt later (no i18n framework needed).
