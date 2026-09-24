# ResidenceFlow

Secure, responsive, multi-building **apartment & rental property management** web application — buildings, units, tenants, leases, automated rent schedules, invoices, payments & receipts, arrears, deposits, maintenance work orders, concierge desk, documents, communications, reports, and a configurable administration panel. English & French, XAF / Africa/Douala defaults, fully configurable.

> The product name, logos, colours, contact details, currency, language and organization identity are all editable in **Administration** — nothing is hard-coded.

**Stack:** Next.js 15 (App Router, server actions) · React 19 · TypeScript (strict) · Tailwind CSS v4 · PostgreSQL · Prisma 6 · Zod · decimal.js · Recharts · Vitest.

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module boundaries, isolation, RBAC, financial transactions, jobs, storage, integrations, ER diagram |
| [PERMISSIONS.md](PERMISSIONS.md) | Every permission and the default role matrix (generated from code) |
| [SECURITY.md](SECURITY.md) | Threat model and controls |
| [DECISIONS.md](DECISIONS.md) | Assumptions and design decisions |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Phases, status, open items |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Deployment (Vercel / Docker), rollback, backup & restore, monitoring |
| [docs/ROUTES.md](docs/ROUTES.md) | Route checklist per role (manual E2E script) |

## Quick start (local)

Requirements: Node 20+ and PostgreSQL 14+ (or `docker compose up db`).

Run each command on its own line (no trailing comments — Windows Command Prompt would pass them to the command).

```bash
cd residenceflow
cp .env.example .env
```

Open `.env` and set `DATABASE_URL` and `DIRECT_URL` to your PostgreSQL database, and give `AUTH_SECRET` and `CRON_SECRET` random values. On Windows, copy the file instead: `copy .env.example .env`.

```bash
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

- If you ever see "@prisma/client did not initialize yet", run `npx prisma generate` once.
- `npm run db:seed` loads the development demo data and accounts (it refuses to run in production).
- `npm run dev` serves the app at http://localhost:3000.
- No PostgreSQL installed? Start one with `docker compose up -d db` and keep the default `DATABASE_URL` from `.env.example`.

Windows note: use Command Prompt or PowerShell from the `residenceflow` folder; the commands above work unchanged.

### Development demo accounts

Created by the seed **in development only**. Password for all: `Demo!Pass2026` (override with `SEED_DEMO_PASSWORD`). **Never use these in production** — production installs are bootstrapped through `/setup`.

| Email | Role |
|---|---|
| superadmin@example.test | Platform super administrator |
| admin@example.test | Organization administrator |
| manager@example.test | Property manager (both buildings) |
| owner@example.test | Property owner |
| accountant@example.test | Accountant / finance officer |
| cashier@example.test | Cashier / rent collector |
| concierge@example.test | Concierge / security desk |
| tenant@example.test | Tenant (Fatou Ndiaye, Résidence Akwa 1B) |
| maintenance.manager@example.test | Maintenance manager |
| technician@example.test | Maintenance technician |
| vendor@example.test | Vendor / contractor (Plomberie Express) |
| auditor@example.test | Auditor (read-only) |

Seed data: 1 organization, 2 buildings, 13 units (occupied, vacant, under maintenance), 6 tenants with active / expiring / overdue leases, issued / paid / partially-paid / overdue invoices, confirmed and pending payments, late fees, deposits, open and closed work orders, visitors, parcels, incidents, expenses, vendors and announcements.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (domain rules: schedules, proration, allocation, aging, late fees, permissions, state machines, templates, TOTP) |
| `npm run test:integration` | Integration tests against PostgreSQL (`DATABASE_URL` → a **test** database): activation → schedule, idempotent invoicing, partial/multi-invoice payments, credit, reversal, separation of duties, concurrent payments, late-fee idempotency, cross-org & cross-building isolation, webhook signature & exactly-once confirmation, job locking |
| `npm run build` | Production build |
| `npm run db:migrate` / `db:migrate:dev` | Apply / create migrations |
| `npm run db:seed` | Seed demo data (dev) |
| `npm run docs:permissions` | Regenerate PERMISSIONS.md |

## Deployment (online version)

### One-click: Vercel + free Postgres

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwouapit999%2Fwouapit999%2Ftree%2Fclaude%2Fsweet-rubin-6rj6yg&root-directory=residenceflow&project-name=residenceflow&env=CRON_SECRET&envDescription=Any%20long%20random%20text.%20Vercel%20Cron%20uses%20it%20to%20call%20the%20daily%20job.)

1. Click the button, sign in to Vercel with GitHub, keep the suggested project name and click **Create/Deploy**. The first build fails on purpose with *"no database URL found"* — that is expected until step 2.
2. In the new project open **Storage → Create Database → Postgres (Neon)**, accept the defaults and click **Connect** (it attaches `POSTGRES_*`/`DATABASE_URL` variables automatically).
3. Open **Deployments → ⋯ → Redeploy**. The build maps the database variables, creates all tables (`prisma migrate deploy`) and builds the app.
4. Open `https://<your-project>.vercel.app/setup` and create your organization and first administrator. `/setup` works only while the database is empty.
5. Done. The daily job (invoices, late fees, reminders, lease expiry, clean-up) runs automatically at 05:00 UTC through Vercel Cron.

Manual import works the same way: **Add New → Project → Import** the repository, set **Root Directory** to `residenceflow`, add the `CRON_SECRET` variable, attach a Postgres store, deploy.

Optional variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` for email; `NEXT_PUBLIC_DEMO_MODE=true` for a demo site (never with real data). Full list in `.env.example`.

### Docker / any server

`docker build -t residenceflow .` then `docker run -p 3000:3000 --env-file .env residenceflow` (runs migrations, then starts). Rollback, backups and the **restore procedure** are in [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Key guarantees

- Passwords are bcrypt-hashed; administrators can send reset links or force a change but can never view or set a password.
- Every query is scoped to the user's organization and (for building-scoped roles) assigned buildings; the tenant portal is bound to the tenant's own records.
- Money uses fixed-precision decimals; payment posting, allocation and reversal are transactional with row locks; issued invoices and receipts are immutable; financial records are never hard-deleted.
- Recurring invoicing and late fees are idempotent; the daily job is protected against concurrent execution.
- Role changes, password resets, logins, financial actions and sensitive document access are audited (append-only, secrets redacted).

## End-to-end tests

The Playwright suite in `tests/e2e/` drives the real UI (login form, server actions, redirects) against a
running build and the seeded demo database. It never edits application code and only creates new records
with unique suffixes, so it can be re-run against the same database.

```bash
# 1. Build and start the app against a seeded database (see "Getting started")
npm run build && PORT=3100 npm start

# 2. In another terminal
npm run test:e2e                       # all specs, 1 worker, 1 retry, list reporter
npx playwright test tests/e2e/smoke.spec.ts
npx playwright test --headed           # watch it run
npx playwright show-trace test-results/<run>/trace.zip   # traces are recorded on the first retry
```

- `E2E_BASE_URL` overrides the target (default `http://localhost:3100`).
- `PW_CHROMIUM` points at a Chromium binary when Playwright's bundled browser is not installed
  (the config falls back to `/opt/pw-browsers/chromium`). Never run `playwright install` in the shared
  environment.
- Specs: `01`-`14` follow the scenario script in `docs/ROUTES.md` (branding, building → unit → tenant →
  lease → invoice → payment → public receipt check, tenant portal balance, maintenance workflow, concierge
  desk, custom role with re-authentication, password reset link, authorization boundaries).
  `smoke.spec.ts` signs in as all 12 demo accounts and opens their main pages; `screenshots.spec.ts`
  regenerates `docs/screenshots/` (indexed in `docs/SCREENSHOTS.md`) at 1280×800 and 390×844.
- Text assertions accept English and French (the UI language depends on the account's locale).
