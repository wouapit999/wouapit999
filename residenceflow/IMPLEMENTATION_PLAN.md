# Implementation plan

Status legend: [x] done · [~] partial / integration point only · [ ] not started

## Phase 1 — Foundation
- [x] Repository setup (Next.js 15, TypeScript strict, Tailwind v4, Prisma 6, Vitest, ESLint)
- [x] Data model for all modules + initial migration + seed
- [x] Authentication: login (email/username), lockout, IP rate limit, sessions, logout, forgot/reset, activation, forced change, MFA (TOTP + recovery codes)
- [x] Organization isolation + RBAC (permission catalogue, system roles, scopes, custom roles)
- [x] Application shell: responsive sidebar, top bar, search, notifications, EN/FR, light/dark
- [x] Admin: general, branding, users, roles, security, financial, notifications, integrations, numbering, audit logs, system status
- [x] Properties and units
- [x] Audit foundation (append-only, sanitised)
**Dependencies:** none. **Risk:** permission gaps → mitigated by helpers + tests.

## Phase 2 — Tenancy and rent
- [x] Tenants, contacts (co-tenants, occupants, guarantors, emergency), documents, portal invitations
- [x] Leases: draft → approval → activation, notice, termination, renewal versions, schedule, events
- [x] Recurring schedules with proration; idempotent invoice generation
- [x] Invoices (manual + scheduled), void, credit notes, printable view
- [x] Manual payments, allocation, receipts (immutable snapshot + verification code), reversals, approvals
- [x] Tenant statements
- [x] Tenant portal
**Risk:** concurrency on balances → row locks + integration test.

## Phase 3 — Operations
- [x] Maintenance requests / work orders (state machine, assignment, notes, evidence, estimates, rating)
- [x] Concierge: visitors (pre-authorisation, check-in/out, host notification), parcels, incidents, lost & found, shifts, key register
- [x] Documents library with versions and expiry
- [x] Announcements, in-app notifications, tenant ↔ management messages
- [x] Inspections (templates by unit, checklist, move-out comparison)

## Phase 4 — Finance and reporting
- [x] Arrears aging, collection notes, promises to pay
- [x] Security deposits (receipts, deductions, refunds, approvals)
- [x] Expenses with approvals, vendors
- [~] Reconciliation — provider references are matched by the webhook service; a bank-statement import screen is not built yet
- [x] Operational & financial reports with CSV export and print-to-PDF
- [~] Utilities & meter readings — data model present; UI not built (optional module)
- [~] Rental applications & screening — optional module; not built (future)
- [~] Payment plans with instalments — promise-to-pay notes only

## Phase 5 — Integrations and hardening
- [~] Payment provider adapter interface + verified, idempotent webhook (generic HMAC adapter); no live mobile-money adapter
- [~] SMS/WhatsApp — notification hook only; email via SMTP
- [x] MFA
- [x] Security review items in SECURITY.md (open items listed there)
- [~] Monitoring — structured JSON logs, health endpoint, JobRun history; plug in Sentry/OTel at `src/lib/action.ts` & route handlers
- [~] Backup/restore drill — performed on the seeded development database (docs/RUNBOOK.md, "Restore drill log"); repeat on a production snapshot before go-live
- [ ] Playwright end-to-end suite (route checklist in docs/ROUTES.md is the manual script)
- [ ] Production-readiness review, penetration test
