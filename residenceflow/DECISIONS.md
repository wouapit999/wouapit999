# Decisions & assumptions

Where the specification left room, the safest reversible option was chosen.

| # | Decision | Rationale / how to change |
|---|---|---|
| D-01 | **Next.js full-stack** (server actions + route handlers), no separate API service. | Spec preference. Services are framework-independent and can be exposed via an API later. |
| D-02 | **bcrypt (cost 12)** via `bcryptjs` instead of Argon2id. | Pure JS — works on Vercel serverless without native builds. Swap in `src/lib/auth/password.ts`. |
| D-03 | **No Redis/BullMQ in the default deployment.** Jobs run from Vercel Cron against idempotent services with a DB-backed `JobRun` lock; rate limiting uses the `LoginAttempt` table. | Vercel has no long-running workers. `docker-compose.yml` ships Redis for teams that add a BullMQ worker; the job functions in `src/services/jobs.ts` are the entry points. |
| D-04 | **Documents stored in PostgreSQL (bytea), max 4 MB.** Branding images stored as validated data URLs (≤ 512 KB). | Zero extra infrastructure; Vercel request limit is 4.5 MB. `src/lib/storage.ts` is the seam for S3 with signed URLs. |
| D-05 | One invoice per lease **per due date**, with one line per charge (rent, service charge). | Matches how tenants pay. Idempotency key `schedule:<lease>:<dueDate>`. |
| D-06 | Monthly-based schedules use **calendar periods** starting on the 1st; partial first/last periods are **prorated by day count** (option per lease). First partial period is due on the move-in date. | Common local practice; per-lease `prorate` flag. |
| D-07 | **Late fees**: at most **one** fee per overdue invoice (fixed or % of outstanding), after the grace period; late-fee invoices never attract further fees. | Avoids compounding; legality varies — fee type defaults to NONE per organization. |
| D-08 | **Separation of duties** on by default: staff-recorded payments ≥ threshold (500 000 XAF) stay pending for a second approver. Tenant-submitted proofs always need staff approval. | Spec rule 11. Configurable in Administration → Financial. |
| D-09 | Payments are allocated **oldest due date first** unless manual lines are provided; excess becomes **unapplied tenant credit** (derived, not a separate ledger). | Spec allocation rules. |
| D-10 | Lease approval and activation are a **single step** (`PENDING_APPROVAL → ACTIVE`), which validates mandatory fields and overlaps and generates the schedule in one transaction. | Fewer half-activated states. |
| D-11 | Leases past their end date are automatically marked **EXPIRED**, but the unit status is **not** changed automatically. | Tenants often stay pending renewal; managers decide. |
| D-12 | Renewals/amendments create a **new lease version** (`previousLeaseId`); the signed lease is never edited. Mid-term rent changes = terminate + renewal. | Spec: never silently edit signed leases. |
| D-13 | Terminating a lease **cancels (flags)** future un-invoiced schedule rows; issued invoices must be credited explicitly. | Financial immutability. |
| D-14 | Role scope is **per role**, and the broadest scope among a user's roles applies. `ASSIGNED_UNITS` currently behaves like `ASSIGNED_BUILDINGS`. | Simpler mental model; data model allows finer scopes later. |
| D-15 | Tenants are visible to building-scoped staff through their **leases**. A new tenant without a lease is visible to organization-wide users only (and its creator via audit). | Prevents leaking tenant lists across buildings. |
| D-16 | Raw identity-document numbers are **never stored** — only a masked value. | Removes the need for field-level encryption of IDs. |
| D-17 | Organization-wide settings live in `OrganizationSettings`; **one active organization** drives the public login branding (single-company deployments). Multi-org hosting works; login branding then shows the first organization. | Custom domains per organization are a listed future enhancement. |
| D-18 | Mobile-money adapters are **interfaces only**. A generic HMAC adapter exists for tests. | Spec forbids claiming integrations work without real credentials and sandbox tests. |
| D-19 | Default language **French**, default currency **XAF**, timezone **Africa/Douala** — all configurable. Timestamps stored in UTC; calendar dates (`@db.Date`) displayed without timezone shifting. | Spec §16. |
| D-20 | Production bootstrap uses a **first-run setup page** (`/setup`, only while no organization exists) instead of demo credentials. Demo seed refuses to run in production unless explicitly forced with a custom password. | Spec §17: never ship demo passwords. |
| D-21 | Global building switcher replaced by **building filters on list pages** and scoped dashboards. | Keeps URLs shareable and scoping server-side. |
