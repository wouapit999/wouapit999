# BI-Rem Lite

The whole BI-Rem programme — the 13 phases planned in [`docs/`](../../docs/README.md) — as one
small Next.js application that runs on nothing but a **GitHub** repository, one **Vercel**
project and one **Neon** database.

It is a working product in miniature, not a mock-up: real sign-in, real PostgreSQL, real
double-entry money movement between wallets, real permissions and audit trail. Only the outside
world is simulated (see [What is simulated](#what-is-simulated)). It sits next to the Phase 1
foundation (`apps/api`, `apps/web`, `apps/admin`) and the roadmap, which stay as they are.

| Read                                   | For                                                               |
| -------------------------------------- | ----------------------------------------------------------------- |
| [`SPEC.md`](./SPEC.md)                 | What Lite must do, phase by phase, and the money-movement rules.  |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | How it is built: routes, services, data model, how to add a page. |
| `/roadmap` in the running app          | The programme, phase by phase, and what Lite already covers.      |

## What is in it

| Area                         | Address                              | Who                                                      |
| ---------------------------- | ------------------------------------ | -------------------------------------------------------- |
| Public site, roadmap, status | `/`, `/roadmap`, `/status`, `/apply` | everyone                                                 |
| Customer app                 | `/app`                               | customers: wallets, top-up, send, track, KYC, security   |
| Back office                  | `/admin`                             | administrator, compliance, treasury, support             |
| Partner portal               | `/partner`                           | merchants, agents, API partners                          |
| Public REST API              | `/api/v1`                            | partners, with an API key (`/partner/docs` documents it) |
| Health                       | `/api/health`                        | monitoring                                               |

## Run locally

You need Node 22, pnpm 10 and PostgreSQL 15 or newer.

```bash
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d postgres   # or any local PostgreSQL
createdb -h localhost -U birem birem_lite                          # once (password: birem)
cp apps/lite/.env.example apps/lite/.env                           # DATABASE_URL is enough locally

pnpm --filter @bi-rem/lite generate          # Prisma client
pnpm --filter @bi-rem/lite migrate:deploy    # create the tables
pnpm --filter @bi-rem/lite seed              # reference data, administrator, demo data
pnpm --filter @bi-rem/lite dev               # http://localhost:3002
```

Without `AUTH_SECRET` / `ENCRYPTION_KEY` the app uses fixed development values and says so in
the log. That is refused in production.

### Demo accounts

Created by the seed outside production, or anywhere `SEED_DEMO_DATA=true`. One password for all
of them: `ChangeMe123!` (the sign-in page lists them too).

| Sign in as                              | Role               | Good for                                               |
| --------------------------------------- | ------------------ | ------------------------------------------------------ |
| `admin@bi-rem.local`                    | Administrator      | everything in the back office                          |
| `compliance@bi-rem.local`               | Compliance officer | KYC queue, held transfers, cases, SARs, audit log      |
| `treasury@bi-rem.local`                 | Treasury officer   | FX rates and margins, fees, float, settlements         |
| `support@bi-rem.local`                  | Support agent      | read-only back office                                  |
| `partner@bi-rem.local`                  | Partner (merchant) | merchant `M-DEMO01`: API keys, webhooks, commissions   |
| `agent@bi-rem.local`                    | Partner (agent)    | agent `A-DEMO01`: float, cash-in, cash-out             |
| `amina@example.com`                     | Customer           | Cameroon, fully verified, funded XAF wallet            |
| `samuel@example.com`                    | Customer           | Cameroon, tier 1                                       |
| `joao@example.com`                      | Customer           | Angola, AOA wallet — send to him to try an FX transfer |
| `maria@example.com`                     | Customer           | Mozambique, KYC case waiting in the review queue       |
| `paul@example.com`, `fatou@example.com` | Customer           | Gabon (XAF), Guinea-Bissau (XOF)                       |

The administrator's address and password come from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`;
the row above is the default.

Things to try: pay merchant `M-DEMO01`; send XAF to `joao@example.com` and watch the quote
countdown; send to a mobile-money number ending `0001` (refused, refunded) or `0003` (pending
until you check the status); send to someone called "Viktor Demo Sanctionov" (held for
compliance); then sign in as compliance and release it.

### Checks

```bash
pnpm --filter @bi-rem/lite lint
pnpm --filter @bi-rem/lite typecheck
pnpm --filter @bi-rem/lite test                    # unit + integration, on real PostgreSQL
pnpm --filter @bi-rem/lite build
pnpm --filter @bi-rem/lite test:e2e                # Playwright: the golden path, access control, link crawl
pnpm --filter @bi-rem/lite test:e2e:walkthroughs   # four long area walk-throughs
```

The test commands create and drop their own databases; they need a PostgreSQL role that may
`CREATE DATABASE` (`TEST_DATABASE_ADMIN_URL`, default `postgresql://birem:birem@localhost:5432`).
The end-to-end suite builds the app, serves it with `next start` on port 3210 against a database
it migrates and seeds itself, and needs Chromium
(`pnpm --filter @bi-rem/lite exec playwright install chromium`, once).
`E2E_BASE_URL=https://… pnpm --filter @bi-rem/lite test:e2e` runs it against a deployed
demonstration instead — it changes the data there.

## Deploy: GitHub + Vercel + Neon

Fifteen minutes, no server to manage. Every push to the production branch then migrates the
database, refreshes the reference data and ships the app.

### 1. GitHub

Push this repository to GitHub (the whole monorepo — Lite reads the roadmap from `docs/`).

### 2. Neon

Create a project at <https://neon.tech> (the free plan is enough; pick the region closest to your
Vercel region). From **Connection details** copy two strings:

- the **pooled** one (the host contains `-pooler`) → `DATABASE_URL`
- the **direct** one → `DATABASE_URL_UNPOOLED`

Alternatively add Neon from Vercel (**Storage → Create Database → Neon**): the integration
creates the project and sets both variables for you.

### 3. Vercel

**Add New… → Project**, import the GitHub repository, then:

| Setting          | Value                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| Root Directory   | `apps/lite` (keep "Include files outside the Root Directory" switched on) |
| Framework Preset | Next.js                                                                   |
| Build / Install  | leave empty — they come from [`vercel.json`](./vercel.json)               |
| Node.js version  | 22.x                                                                      |

Environment variables (**Production**):

| Variable                | Value                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`          | Neon pooled connection string                                                                                |
| `DATABASE_URL_UNPOOLED` | Neon direct connection string (used by migrations and the seed)                                              |
| `AUTH_SECRET`           | output of `openssl rand -base64 48`                                                                          |
| `ENCRYPTION_KEY`        | output of `openssl rand -base64 32` — keep a copy: it decrypts the stored secrets                            |
| `SEED_ADMIN_EMAIL`      | your administrator e-mail                                                                                    |
| `SEED_ADMIN_PASSWORD`   | a strong password, at least 10 characters (the build fails without it)                                       |
| `SEED_DEMO_DATA`        | `true` for a demonstration with the demo accounts and 30 days of history; leave it out for an empty platform |

Press **Deploy**. The build runs `pnpm run vercel-build`:

```
sync-roadmap → prisma generate → prisma migrate deploy → seed → next build
```

The seed is idempotent: it upserts the reference data (countries, providers, FX rates, fee
rules, AML rules), creates the administrator if missing and never touches it again, and adds the
demo data only once. Redeploying is always safe.

### 4. Check

- `https://<your-app>.vercel.app/api/health` answers `{"status":"ok", …}`.
- `/status` shows the database and the simulated operators as operational.
- Sign in as the administrator and switch on two-factor authentication (**My security**).

### Things to know

- **`SEED_DEMO_DATA=true` on a public address means public credentials.** Every demo account,
  including the demo compliance and treasury officers, uses the password printed above and shown
  on the sign-in page. That is the point of a demonstration; do not combine it with anything real.
  To retire the demo accounts later, suspend them from **Staff & roles** / **Customers**.
- **Preview deployments run the same build**, so they migrate and seed whatever database their
  variables point to. Give the Preview environment its own Neon branch (the Vercel–Neon
  integration can create one per preview), or leave the variables unset for Preview.
- **Vercel Hobby limits** fit: no cron, no queue, no object storage; request bodies stay under
  4.5 MB (KYC documents are at most 1 MB each).
- **Rotating `ENCRYPTION_KEY`**: set the new key, raise `ENCRYPTION_KEY_VERSION`, and put the old
  key in `ENCRYPTION_KEYS_PREVIOUS` (`{"1":"<old base64 key>"}`) so existing secrets still
  decrypt. **Rotating `AUTH_SECRET`** signs everyone out.
- **Provider webhooks** arrive at `POST /api/webhooks/providers/<provider code>` with the header
  `x-birem-signature: t=<unix>,v1=<hmac-sha256(secret, "<t>.<raw body>")>`. Generate the secret
  on the provider's page in the back office.
- **Roadmap copies**: `/roadmap` and `/roadmap-full.html` are copies of `docs/roadmap/`, refreshed
  by every build (`pnpm --filter @bi-rem/lite sync:roadmap`); a unit test fails if they drift.

## What is simulated

Everything inside the platform is real. What stands in for the outside world is labelled
"Simulated" wherever it appears:

| Simulated                                                                                                                                                                                                                                             | Real                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Mobile-money operators** (MTN MoMo, Orange Money, Airtel Money, Moov Money, M-Pesa, Unitel Money, e-Mola): a deterministic simulator answers account checks, payouts, top-ups and status queries. No operator is contacted and no real money moves. | The connector interface, the provider registry, encrypted credentials, signed webhooks with replay protection, idempotency. |
| **KYC vendors** (Veriff, Sumsub, Smile Identity): the decision is derived from the ID number. No identity is checked.                                                                                                                                 | Document upload and storage, the review queue, tiers and limits.                                                            |
| **Sanctions / PEP list**: a short fictional list seeded for the demo.                                                                                                                                                                                 | The screening engine, AML rules, holds, cases, SAR workflow.                                                                |
| **FX rates**: illustrative seed values with no live feed.                                                                                                                                                                                             | Quotes, margins, cross-currency ledger postings, treasury positions.                                                        |
| **Top-ups**: the wallet is credited without any real cash-in.                                                                                                                                                                                         | The double-entry ledger, balances, statements, reversals.                                                                   |
| **SAR filing**: recorded with a reference; nothing is transmitted to a regulator.                                                                                                                                                                     | The audit log of every mutation.                                                                                            |

A generic `HttpConnector` exists for real operator endpoints, but it has never been run against
one. Native mobile apps (phase 11) remain on the roadmap: Lite is a responsive, installable PWA.

**Lite is a demonstration.** It has no operator contract, no licence, no licensed screening data
and no regulator reporting. Before anything real, work through
[`docs/07-go-live-checklist.md`](../../docs/07-go-live-checklist.md); known gaps are listed in
`ARCHITECTURE.md` §10.
