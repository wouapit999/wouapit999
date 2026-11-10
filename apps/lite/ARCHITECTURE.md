# BI-Rem Lite — architecture and contracts

How Lite is built: what exists, the exact functions to call, where each route lives and how to
write pages, actions and tests. `SPEC.md` stays the binding specification; `README.md` covers
running and deploying.

- [1. Shape of the app](#1-shape-of-the-app)
- [2. Route map](#2-route-map)
- [3. Rules that are not negotiable](#3-rules-that-are-not-negotiable)
- [4. How to write a page, an action and a route handler](#4-how-to-write-a-page-an-action-and-a-route-handler)
- [5. UI kit](#5-ui-kit)
- [6. Server modules — public API](#6-server-modules--public-api)
- [7. Data model cheat sheet](#7-data-model-cheat-sheet)
- [8. Running: database, dev server, tests, e2e](#8-running-database-dev-server-tests-e2e)
- [9. Seeded data](#9-seeded-data)
- [10. Known gaps](#10-known-gaps)

## 1. Shape of the app

```
apps/lite/
  prisma/schema.prisma, migrations/, seed.ts     one migration + hand-written integrity guards
  prisma.config.ts                               datasource = DATABASE_URL_UNPOOLED ?? DATABASE_URL
  src/proxy.ts                                   x-request-id + first-line guard for /app /admin /partner
  src/app/                                       App Router (Server Components by default)
  src/components/ui/                             UI kit            import from '@/components/ui'
  src/components/shell/                          AppShell, PublicShell, nav definitions
  src/components/{customer,admin,partner}/       area components (wizards, charts, forms)
  src/lib/                                       cn, format, action-state, server-action, http
  src/server/                                    domain services — the only code that touches the DB
  src/data/                                      roadmap schedule (copy of docs/) + per-phase Lite notes
  src/generated/prisma/                          generated client (git-ignored) — `pnpm generate`
  tests/unit, tests/integration                  vitest: pure logic, and services on real PostgreSQL
  tests/customer, tests/admin, tests/partner     vitest: area helpers, access matrix, API contract
  tests/e2e/                                     Playwright suite (golden path, access, link crawl)
  tests/e2e/walkthroughs/                        four long scripted area walk-throughs
  tests/helpers/                                 test databases, factories
```

Layering: **page / action / route handler → `src/server/**` service → Prisma**. Pages and
actions never query money tables directly; they call services, passing an `ActionContext`.
Services enforce authorisation and write the audit row themselves, so a forgotten check in a
page cannot open a hole.

Self-contained: Lite does not import `@bi-rem/db`, `@bi-rem/shared` or `apps/api`. It reuses only
the `@bi-rem/config` tsconfig / ESLint presets.

Imports you will use all the time:

```ts
import { getPageContext, getActionContext } from '@/server/auth/session'; // server-only
import { db } from '@/server/db'; // lazy PrismaClient singleton
import { AppError } from '@/server/errors';
import { formatMoney, parseMoney, serialize } from '@/server/money';
import type { Role, TransferStatus } from '@/generated/prisma/enums'; // safe in Client Components
import type { Transfer } from '@/generated/prisma/client'; // server only
```

`src/server/**` has no `'server-only'` marker except `auth/session.ts` (the seed runs these
modules under plain `tsx`). Never import `@/server/*` from a Client Component, except the pure
helpers `@/server/money` and types.

## 2. Route map

| Area                       | Routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Notes                                                                                                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public                     | `/`, `/login`, `/register`, `/roadmap`, `/status`, `/apply`, `/apply/submitted`, `/roadmap-full.html` (static copy of `docs/roadmap/index.html`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `/partners/apply` redirects to `/apply`                                                                                                                                                                                                             |
| Customer (`CUSTOMER`)      | `/app`, `/app/send`, `/app/wallets`, `/app/wallets/[id]` (statement), `/app/wallets/topup`, `/app/transfers`, `/app/transfers/[id]` (tracking), `/app/transfers/[id]/receipt`, `/app/beneficiaries`, `/app/beneficiaries/[id]`, `/app/kyc`, `/app/notifications`, `/app/profile`, `/app/security`                                                                                                                                                                                                                                                                                                                | `/app/topup` redirects to `/app/wallets/topup`                                                                                                                                                                                                      |
| Customer files             | `GET /app/transfers/[id]/receipt/pdf`, `GET /app/kyc/documents/[id]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | session + ownership; 404 for anything not the caller's                                                                                                                                                                                              |
| Back office (staff roles)  | `/admin` (executive dashboard), `/admin/transfers` + `/[id]`, `/admin/customers` + `/[id]` (360° view, also for staff and partner users), `/admin/kyc` + `/[id]`, `/admin/compliance` (tabs: dashboard, alerts, cases, SARs, rules, screening) + `/cases/[id]`, `/admin/audit`, `/admin/providers` + `/new` + `/[id]`, `/admin/countries`, `/admin/fees`, `/admin/fx`, `/admin/treasury` (float, thresholds, reconciliation), `/admin/partners` + `/new` + `/[id]`, `/admin/reports` (five dashboards + exports), `/admin/users` (staff and roles), `/admin/settings`, `/admin/security`, `/admin/notifications` | redirects kept for links the services emit: `/admin/aml` → `/admin/compliance`, `/admin/aml/cases/[id]` → `/admin/compliance/cases/[id]`, `/admin/users/[id]` → `/admin/customers/[id]`, `/admin/reconciliation` → `/admin/treasury#reconciliation` |
| Back-office files          | `GET /api/exports/[name]?format=csv\|xlsx\|pdf`, `GET /admin/kyc/documents/[documentId]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `reports:export` (+ dataset permission) / `kyc:review`; both audited                                                                                                                                                                                |
| Partner portal (`PARTNER`) | `/partner`, `/partner/transactions` + `/[id]`, `/partner/commissions`, `/partner/settlements`, `/partner/api-keys`, `/partner/webhooks`, `/partner/docs`, `/partner/profile`, `/partner/float` (agents only; 404 for others)                                                                                                                                                                                                                                                                                                                                                                                     | every page starts with `getPartnerPage()` (`src/app/partner/_lib/partner.ts`)                                                                                                                                                                       |
| Public REST API            | `GET /api/v1` (index), `GET /api/v1/openapi.json`, `GET /api/v1/me`, `/providers`, `/rates`, `POST /api/v1/quotes`, `POST` + `GET /api/v1/transfers`, `GET /api/v1/transfers/{reference}`, `POST /api/v1/transfers/{reference}/refresh`                                                                                                                                                                                                                                                                                                                                                                          | API key (`Authorization: Bearer brl_…`), RFC 9457 problem documents; index and OpenAPI document are public                                                                                                                                          |
| Operators                  | `POST /api/webhooks/providers/[code]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | HMAC signature + replay protection, no session                                                                                                                                                                                                      |
| Platform                   | `GET /api/health`, `/manifest.webmanifest`, icons                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | public                                                                                                                                                                                                                                              |

Who may open what: `src/proxy.ts` sends a signed-out visitor to `/login?next=…` and a signed-in
user of the wrong role to their own area (`canAccessPath`); the three area layouts and every
page check again against the live session; back-office pages that need a permission call
`requirePermission(...)`, which sends the user back to `/admin`. The navigation
(`src/components/shell/nav.ts`) shows staff only the sections their role may open.

Public API internals (`src/app/api/v1/**`): `_lib/handler.ts` (`v1Route({ scope }, handler)`:
API-key auth → scope check → handler → problem document on error), `_lib/schemas.ts` (Zod;
amounts are strings of minor units), `_lib/transfers.ts` (wallet / recipient resolution, JSON
shapes), `_lib/problem.ts`, and `_lib/reference.ts` — the endpoint catalogue rendered by
`/partner/docs`, `GET /api/v1` and the OpenAPI document. Adding an endpoint = a `route.ts` plus an
entry in `reference.ts` (a test checks they agree). `POST /transfers` requires `Idempotency-Key`;
a replay answers 200 with `Idempotent-Replayed: true`, the same key for a different request 409.

Agent cash-in lives in `src/app/partner/_lib/cash-in.ts` (`planCashIn`, `executeCashIn`): an
ACTIVE agent credits a same-country, same-currency customer wallet from its float through
`createTransfer`, with an idempotency key minted by the preview.

Roadmap copies: `pnpm --filter @bi-rem/lite sync:roadmap` (also run by `build` and
`vercel-build`) copies `docs/roadmap/schedule.json` → `src/data/roadmap-schedule.json` and
`docs/roadmap/index.html` → `public/roadmap-full.html`, pointing the HTML's `../phases/…` links
at `/roadmap#phase-<id>`; `--check` fails on drift; without `docs/` it keeps the committed copies.

Notification links emitted by the services (keep these paths or adjust the services):
`/app/transfers/<id>`, `/app/kyc`, `/app/profile`, `/admin/kyc/<caseId>`,
`/admin/aml/cases/<caseId>`, `/admin/partners/<partnerId>`, `/admin/security`, `/partner`,
`/partner/profile`, `/partner/settlements`. (`securityPathFor(role)` in `@/server/auth` gives the
password / MFA page of a role.)

Schema changes: add a **new** migration, never edit the initial one (deployed databases have
already applied it).

## 3. Rules that are not negotiable

1. **Authorise on the server, every time.** Layouts guard the area, but every page calls
   `getPageContext(...)` and every action goes through `createAction` (or calls
   `getActionContext()`); every service call receives `ctx`. Never trust an id from the client:
   services return `NOT_FOUND` for objects the actor does not own.
2. **Validate every input with Zod** (form fields, search params, JSON bodies). Schemas for most
   service inputs are exported next to the service (`createTransferSchema`, `beneficiarySchema`…).
3. **Money is `bigint` minor units + currency.** No floats, no `Number(amount)`, no `parseFloat`
   (ESLint forbids it). Parse user input with `parseMoney(text, currency)`; display with
   `<Money>` / `formatMoney`. Across the server → client boundary pass `serialize(value)`
   (bigint/Date/Decimal → string); `<Money>` accepts the string form.
4. **Money moves only through the engine**: `createTransfer`, `topUpWallet`, `releaseCase` /
   `rejectCase`, `reverseTransfer`, `createSettlement`, `moveFloat`. Never write to
   `ledger_accounts`, `ledger_entries`, `journals` or `transfers` yourself.
5. **Secrets are write-only.** Provider credentials, webhook secrets, API keys and TOTP secrets
   are never returned after creation (API keys and generated webhook secrets exactly once).
   Never log or audit them — `writeAudit` redacts keys that look sensitive, do not defeat it.
6. **Say what is simulated.** Every provider view exposes `simulated`; KYC vendor results carry
   `simulated: true`. Show `<SimulatedBadge />` wherever a sandbox provider or a KYC vendor
   decision is displayed.
7. **Append-only tables**: `audit_logs`, `journals`, `ledger_entries`, `transfer_events` reject
   UPDATE and DELETE at the database level (trigger). Do not try.
8. Errors: services throw `AppError(code, message, { fieldErrors })`. Codes: `VALIDATION`,
   `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INVALID_STATE`, `INSUFFICIENT_FUNDS`,
   `LIMIT_EXCEEDED`, `KYC_REQUIRED`, `QUOTE_EXPIRED`, `UNSUPPORTED`, `RATE_LIMITED`,
   `PROVIDER_ERROR`, `INTERNAL`. `createAction` and `apiError` map them for you.

## 4. How to write a page, an action and a route handler

### Page (Server Component)

```tsx
// src/app/app/transfers/page.tsx
import { z } from 'zod';
import { PageHeader, Card, Table, THead, TBody, Tr, Th, Td, Money, StatusBadge, Pagination } from '@/components/ui';
import { getPageContext } from '@/server/auth/session';
import { listMyTransfers } from '@/server/transfers';

const querySchema = z.object({ page: z.coerce.number().int().min(1).catch(1) });

export default async function TransfersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { ctx } = await getPageContext('CUSTOMER'); // redirects: signed out → /login, other roles → their area
  const { page } = querySchema.parse(await searchParams);
  const result = await listMyTransfers(ctx, { page });
  return (/* … <Money amount={item.amount} currency={item.currency} /> … */);
}
```

- `getPageContext(...roles)` → `{ ctx, user }`. For the back office use
  `getPageContext(...STAFF_ROLES)` and let the service's permission check decide, or
  `requirePermission('fx:write')` to redirect early. A service that throws `FORBIDDEN` inside a
  page ends on the error boundary — hide links the role cannot use
  (`roleHasPermission(user.role, 'fx:write')`).
- Pages that read the session are dynamic automatically. Do not add caching to money pages.
- Passing data to a Client Component: `serialize(data)` first.

### Server action (auth + validation + audit)

```ts
// src/app/app/beneficiaries/actions.ts
'use server';

import { z } from 'zod';
import { createAction } from '@/lib/server-action';
import { createBeneficiary, archiveBeneficiary } from '@/server/beneficiaries';

// Schemas must NOT be exported from a 'use server' file (only async functions may be).
const addSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  method: z.enum(['WALLET', 'MOBILE_MONEY']),
  accountNumber: z.string().trim().min(3),
  providerId: z.uuid().optional(),
});

export const addBeneficiaryAction = createAction({
  schema: addSchema,
  roles: ['CUSTOMER'], // and/or permission: 'fx:write' in the back office
  handler: (input, ctx) => createBeneficiary(ctx, input), // the service authorises again + audits
  successMessage: 'Beneficiary saved',
  revalidate: ['/app/beneficiaries'],
  // redirectTo: (result) => `/app/beneficiaries/${result.id}`,
});
```

What `createAction` does for you: loads the session (`UNAUTHENTICATED` → message, no crash),
checks `roles` / `permission`, converts `FormData` to an object (`formDataToObject`: empty
strings dropped, repeated keys and `name[]` → arrays, `File`s kept), validates with the schema
and returns `fieldErrors`, runs the handler, maps `AppError`/`ZodError` to
`{ ok: false, message, fieldErrors, values }`, revalidates, redirects, and returns
`{ ok: true, message, data }` with `data` serialised. The audit row is written by the service
inside the same transaction as the change. If you add a mutation that has no service function,
write one in `src/server/**` that calls `writeAudit(tx, ctx, { action, resourceType, resourceId,
before, after })` — or wrap it with `withAudit(ctx, entry, fn)`.

Signed-out forms (partner application) use `createPublicAction({ schema, handler: (input, meta)
=> …, redirectTo })`; `meta` is `{ ip, userAgent, requestId }`.

Money fields in forms: take text, parse in the handler:
`const amount = parseMoney(input.amount, wallet.currency)` (throws `VALIDATION`). Always send an
`idempotencyKey` hidden field generated once per form render (`crypto.randomUUID()` in the page)
so a double click or a retry never pays twice.

File uploads (KYC): `const file = formData.get('idFront') as File` →
`new Uint8Array(await file.arrayBuffer())`; `next.config.ts` allows 5 MB action bodies (four documents of 1 MB).

### The form (Client or Server Component)

```tsx
import { ActionForm, Input, Select, FormMessage, SubmitButton } from '@/components/ui';
import { addBeneficiaryAction } from './actions';

<ActionForm action={addBeneficiaryAction} className="space-y-4">
  <Input name="fullName" label="Full name" required />
  <Select
    name="method"
    label="Send to"
    options={[{ value: 'WALLET', label: 'BI-Rem wallet' }]}
    required
  />
  <Input name="accountNumber" label="Phone, e-mail or code" required />
  <FormMessage />
  <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
</ActionForm>;
```

`ActionForm` is a Client Component but can be rendered from a Server Component with a server
action prop. Fields show `fieldErrors[name]` themselves and keep their values after an error.
To read the result (e.g. show a one-time API key) use the render prop:
`<ActionForm action={…}>{(state) => state.ok && state.data ? <Secret value={state.data.secret} /> : <Fields />}</ActionForm>`
— this requires the enclosing file to be a Client Component.

A plain button that mutates (mark read, revoke, sign out) is a `<form action={someAction}>` with
a hidden input; for `createAction` actions use `<ActionForm>` with only a `<SubmitButton>`.

### Route handler

```ts
// src/app/api/v1/transfers/route.ts
import { apiHandler, apiOk, readJson } from '@/lib/http';
import { authenticateApiKey, assertApiScope } from '@/server/partners';

export const runtime = 'nodejs';

export const POST = apiHandler(async (request: Request) => {
  const auth = await authenticateApiKey(request.headers.get('authorization'), {
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request.headers.get('user-agent'),
    requestId: request.headers.get('x-request-id'),
  });
  assertApiScope(auth, 'transfers:write');
  const body = bodySchema.parse(await readJson(request)); // amounts as minor-unit strings
  const { transfer } = await createTransfer(auth.ctx, { …, idempotencyKey: request.headers.get('idempotency-key') ?? '' });
  return apiOk(transfer, { status: 201 });
});
```

`@/lib/http`: `apiOk(data, { status?, headers? })` → `{ data }` (serialised),
`apiError(error)` → `{ error: { code, message, fields? } }` with the right status,
`apiHandler(fn)` wraps both, `readJson(request, maxBytes?)`,
`fileResponse(bytes, { contentType, fileName, inline? })` for downloads (attachment, nosniff,
no-store). Session-authenticated handlers call `getActionContext()` (throws `UNAUTHENTICATED`).

Provider webhook route: read the **raw** body (`await request.text()`) and call
`handleProviderWebhook({ providerCode, rawBody, signature: request.headers.get('x-birem-signature') })`
from `@/server/connectors/webhooks`; answer 200 for `PROCESSED` / `DUPLICATE` / `IGNORED`.

## 5. UI kit

`import { … } from '@/components/ui'`. Tailwind 4 tokens (see `src/app/globals.css`): surfaces
`bg-surface`, `bg-surface-muted`, `bg-surface-raised`; text `text-fg`, `text-fg-muted`,
`text-fg-subtle`; `border-border`, `border-border-strong`; `bg-accent text-accent-fg`,
`bg-accent-soft text-accent`; status pairs `bg-{success|warning|danger|info}-soft
text-{success|warning|danger|info}`; brand scales `brand-50…950` (green `#0B6E4F` = `brand-600`)
and `gold-50…900` (`#F2B705` = `gold-500`). Light/dark flips automatically through
`prefers-color-scheme` — do not add `dark:` variants for these tokens. Utility `tabular` for
numbers; `no-print` to hide chrome on printed receipts.

| Component                                                                    | Props (main)                                                                              | Notes                                                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Button`                                                                     | `variant` primary/secondary/ghost/danger/gold, `size` sm/md/lg                            | `type="button"` by default                                                             |
| `LinkButton`                                                                 | `href`, `variant`, `size`                                                                 | navigation only                                                                        |
| `buttonClasses(variant, size, extra?)`                                       | —                                                                                         | class string for custom elements                                                       |
| `Card`, `CardHeader`, `CardBody`, `CardFooter`                               | `Card padded`; `CardHeader title description action`                                      |                                                                                        |
| `Badge`                                                                      | `tone` neutral/success/warning/danger/info/brand/gold                                     |                                                                                        |
| `StatusBadge`                                                                | `status`, `label?`                                                                        | knows every status enum (transfer, KYC, AML, provider, health, liquidity, commission…) |
| `SimulatedBadge`                                                             | —                                                                                         | use next to simulated providers / KYC vendors                                          |
| `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td`                                  | `Table caption` (required, sr-only), `Th/Td align`                                        | scrolls horizontally on mobile                                                         |
| `Stat`, `StatGrid`                                                           | `label`, `value`, `hint?`, `tone?`                                                        | KPI tiles                                                                              |
| `EmptyState`                                                                 | `title`, `description?`, `action?`                                                        |                                                                                        |
| `Alert`                                                                      | `tone` info/success/warning/danger, `title?`                                              | danger/warning use `role="alert"`                                                      |
| `Money`                                                                      | `amount: bigint \| string`, `currency`, `signed?`, `withCode?`                            | never format money by hand                                                             |
| `PageHeader`                                                                 | `title`, `description?`, `actions?`, `back?: { href, label }`                             | one `<h1>` per page                                                                    |
| `Pagination`                                                                 | `page`, `pageSize`, `total`, `hrefFor(page)`                                              | Server Component only (function prop)                                                  |
| `DescriptionList`                                                            | `items: { label, value }[]`                                                               | detail pages                                                                           |
| `Input`, `Textarea`, `Select`, `Checkbox` (client)                           | `name`, `label` (required), `hint?`, `error?`, `hideLabel?`; `Select options placeholder` | label, `aria-invalid`, `aria-describedby`, server errors and value echo are wired      |
| `ActionForm` (client)                                                        | `action`, `onResult?`, children or `(state) => node`                                      | `useActionState` wrapper                                                               |
| `FormMessage`, `SubmitButton`, `ConfirmSubmitButton`, `FormActions` (client) | `SubmitButton pendingLabel`; `ConfirmSubmitButton confirm="Are you sure?"`                | use inside `ActionForm` (or any `<form>`)                                              |
| `useFormState()`, `useFieldError(name)` (client hooks)                       | —                                                                                         | for custom fields                                                                      |

Shells: `AppShell` (`src/components/shell/app-shell.tsx`) is already mounted by the three area
layouts — pages render only their content, starting with `<PageHeader>`. It takes `nav`,
`badges` (unread counts by href) and an optional `banner`. `PublicShell` wraps public pages.
`Logo` / `LogoMark` in `src/components/logo.tsx`.

Formatting helpers (`@/lib/format`, usable client-side): `formatDate`, `formatDateTime` (UTC),
`formatRelative`, `formatBps(175) → '1.75%'`, `humanize('ON_HOLD')`, `formatCompact`.

Accessibility baseline: every control has a visible label; tables have captions; status is
never colour-only (badges carry text); focus ring is global; keep one `<h1>` per page and do not
skip heading levels.

## 6. Server modules — public API

Conventions: `ctx: ActionContext` is always the first argument of a service call that acts for
someone. `client: DbOrTx` means "the root `db` or a transaction". "Perm" is the permission the
function asserts; "owner" means the actor must own the object (else `NOT_FOUND`). All money is
`bigint` minor units. List functions return `{ items, total, page, pageSize }` unless noted.

### env — `@/server/env`

`getEnv(): Env` (memoised, validated with Zod) → `{ nodeEnv, isProduction, databaseUrl,
databaseUrlUnpooled, databasePoolMax, authSecret, encryptionKey, encryptionKeyVersion,
previousEncryptionKeys, seedAdminEmail, seedAdminPassword, seedAdminPasswordProvided,
seedDemoData, appName }`. `parseEnv(source)`, `resetEnvCache()` (tests). Production requires
`AUTH_SECRET` and `ENCRYPTION_KEY`; development falls back to fixed values with a warning.
Extra optional vars: `DATABASE_POOL_MAX` (default 5), `ENCRYPTION_KEY_VERSION`,
`ENCRYPTION_KEYS_PREVIOUS` (JSON `{ "1": "<base64>" }`), `RATE_LIMIT_STRICT=1`.

### db — `@/server/db`

`db` (lazy `PrismaClient` singleton on `globalThis`, pg adapter, pool 5),
`withTransaction(fn: (tx: Tx) => Promise<T>): Promise<T>` (retries deadlocks/serialisation
failures), `disconnectDb()`, types `Db`, `Tx`, `DbOrTx`, re-export `Prisma`.

### errors — `@/server/errors`

`AppError`, `isAppError`, `notFound(what)`, `forbidden(msg?)`, `invalidState(msg)`,
`validation(msg, fieldErrors?)`, `isUniqueViolation(error)`, `ERROR_STATUS`.

### money — `@/server/money` (pure; safe on the client)

`CURRENCIES`, `CURRENCY_CODES`, `isCurrencyCode`, `currencyInfo(code)`, `currencyExponent(code)`,
`formatMoney(minor, currency, { withCode?, signed? })`, `toMajorString(minor, currency)`,
`parseMoney(text, currency): bigint`, `parseMinor(text): bigint`,
`bpsOf(amount, bps, rounding?)`, `divRound(n, d, 'floor'|'ceil'|'half_up')`,
`RATE_SCALE` (10^10), `parseRate(string | Decimal): bigint`, `formatRate(scaled, minDecimals?)`,
`rateToDecimalString`, `applyMargin(mid, bps)`, `convertAmount(amount, rate, from, to, rounding?)`,
`invertRate`, `serialize(value)`, `toBigInt(sqlAggregate)`.

### crypto — `@/server/crypto`

`encryptSecret(plain): string` / `decryptSecret(envelope)` (AES-256-GCM,
`v<keyVersion>.<iv>.<tag>.<ct>`), `secretKeyVersion`, `reencryptSecret`; `hashPassword`,
`verifyPassword` (scrypt); `sha256Hex`, `hashToken`, `randomToken(bytes?)`, `randomCode(length)`,
`hmacSha256Hex`, `timingSafeEqualString`; `signWebhookPayload(secret, body, at?)` →
`t=<unix>,v1=<hex>`; `verifyWebhookSignature(secrets, body, header, { toleranceSeconds?, now? })`;
`WEBHOOK_SIGNATURE_HEADER = 'x-birem-signature'`.

### rbac — `@/server/rbac`

Types `ActionContext { actor, ip?, userAgent?, requestId? }`, `Actor = UserActor | ApiKeyActor |
SystemActor`, `Permission`. `PERMISSIONS`, `ROLE_PERMISSIONS`, `ROLE_LABELS`, `STAFF_ROLES`
(`ADMIN`, `COMPLIANCE`, `TREASURY`, `SUPPORT`). `roleHasPermission(role, perm)`,
`hasPermission(ctx, perm)`, `assertPermission(ctx, perm)`, `assertAnyPermission(ctx, perms)`,
`isStaffRole`, `isStaff(ctx)`, `homePathForRole(role)`, `canAccessPath(role, pathname)`,
`requireUserActor(ctx)`, `actorUserId(ctx)`, `actorPartnerId(ctx)`, `systemContext(label)`
(trusted in-process callers only — seed, webhooks, tests; bypasses permission checks).

| Role       | Permissions                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| CUSTOMER   | `customer:access`                                                                                                                  |
| PARTNER    | `partner:access`                                                                                                                   |
| ADMIN      | every back-office permission                                                                                                       |
| COMPLIANCE | read set + `kyc:review`, `aml:read`, `aml:write`, `sar:write`, `sanctions:write`, `audit:read`, `reports:export`                   |
| TREASURY   | read set + `fees:write`, `fx:write`, `treasury:read`, `treasury:write`, `settlements:write`, `transfers:refresh`, `reports:export` |
| SUPPORT    | read set + `transfers:refresh`, `aml:read`                                                                                         |

Read set = `admin:access`, `users:read`, `kyc:read`, `transfers:read`, `providers:read`,
`partners:read`, `fees:read`, `fx:read`, `reports:read`. ADMIN-only: `users:write`,
`providers:write`, `providers:test`, `countries:write`, `partners:write`, `transfers:reverse`,
`settings:write`.

### auth — `@/server/auth` (pure) and `@/server/auth/session` (Next-bound)

`@/server/auth`: `registerCustomer(input, meta?)`, `login(input, meta?)` →
`{ status: 'OK', user, token, expiresAt, sessionId } | { status: 'MFA_REQUIRED' }` (lockout
after 5 failures for 15 minutes; rate limited), `resolveSession(token)`, `logout(sessionId, ctx)`,
`revokeAllSessions(userId, exceptSessionId?)`, `changePassword(ctx, { currentPassword,
newPassword }, currentSessionId?)`, `beginMfaEnrolment(ctx)` → `{ secret, otpauthUri }`,
`confirmMfaEnrolment(ctx, code)`, `disableMfa(ctx, { password, code })`, `getProfile(ctx)`,
`updateProfile(ctx, input)`, `listSessions(ctx)`. Schemas: `registerSchema`, `loginSchema`,
`changePasswordSchema`, `profileSchema`, `emailSchema`, `passwordSchema`, `phoneSchema`. Type
`SessionUser { id, email, fullName, phone, role, status, countryCode, kycTier, kycStatus,
riskLevel, mfaEnabled, partnerId, createdAt }`. TOTP helpers: `totpCode`, `verifyTotp`,
`generateTotpSecret`, `totpAuthUri`.

`@/server/auth/session`: `getSession()` (cached per request), `getCurrentUser()`,
`requireUser()`, `requireRole(...roles)`, `requirePermission(perm)`,
`getPageContext(...roles)` → `{ ctx, user }` (pages), `getActionContext()` → `ctx` (actions and
route handlers; throws `UNAUTHENTICATED`), `getRequestMeta()`, `setSessionCookie`,
`clearSessionCookie`, `endSession()`. Cookie `birem_session`: HS256 JWT `{ sub, sid, role }`,
httpOnly, SameSite=Lax, Secure in production, 12 h; each request re-checks the `sessions` row,
so logout, suspension and role changes apply immediately.

MFA page hint: show `secret` and `otpauthUri` from `beginMfaEnrolment` as text / a link (no QR
library is installed); the secret cannot be read again.

`@/server/auth/own-sessions` (not re-exported by the index): `revokeOwnSession(ctx, sessionId)`
(`NOT_FOUND` for anybody else's session) and `revokeOtherOwnSessions(ctx, keepSessionId)` — the
only functions the security pages may call with a session id that came from the browser.

### audit — `@/server/audit`

`writeAudit(client, ctx, { action, resourceType, resourceId?, outcome?, before?, after?,
metadata?, at? })`, `withAudit(ctx, entry, fn, describe?)`, `toAuditJson(value)`,
`listAuditLogs(ctx, { actorId?, action?, resourceType?, resourceId?, outcome?, from?, to?, page?,
pageSize? })` — perm `audit:read`.

### notifications — `@/server/notifications`

`notify(client, { userId, type, title, body, href?, data?, at? })`,
`notifyRoles(client, roles, input)`, `listNotifications(ctx, { unreadOnly?, limit? })`,
`countUnreadNotifications(ctx)`, `markNotificationRead(ctx, id)`,
`markAllNotificationsRead(ctx)` — all scoped to the signed-in user.

### settings — `@/server/settings`

`getSetting(key, client?)`, `listSettings(ctx)` (perm `admin:access`), `setSetting(ctx, key,
value)` (perm `settings:write`, audited). Keys: `kyc.limits`, `kyc.autoApprove`,
`kyc.defaultVendor`, `aml.holdScore`, `aml.matchThreshold`, `fx.quoteTtlMinutes`,
`platform.maintenance`. `SETTING_DEFINITIONS` holds schema, default and description per key.

### rate-limit — `@/server/rate-limit`

`hitRateLimit(key, rule, now?)`, `enforceRateLimit(key, rule)` (throws `RATE_LIMITED`; ×20
outside production unless `RATE_LIMIT_STRICT=1`), `RATE_LIMITS` (`loginPerIp`, `loginPerEmail`,
`registerPerIp`, `partnerApplicationPerIp`, `apiPerKey`, `webhookPerProvider`),
`purgeExpiredRateLimits()`.

### wallets — `@/server/wallets`

`listMyWallets(ctx): WalletView[]` (own or own partner's), `getWallet(ctx, walletId)` (owner or
`transfers:read`), `getWalletStatement(ctx, walletId, { limit?, before? })` → lines
`{ entryId, journalId, kind, description, transferId, direction, amount, delta, balanceAfter,
currency, createdAt }`, `listWalletsOfUser(ctx, userId)` (perm `users:read`),
`findRecipientWallet(client, identifier, currency?)` (phone / e-mail / partner code →
`RecipientWallet | null`), `ensureUserWallet`, `ensurePartnerWallet`, `ownsWallet(ctx, wallet)`.
`WalletView { id, type, status, currency, balance, ledgerAccountId, userId, partnerId, createdAt }`.

### beneficiaries — `@/server/beneficiaries` (customer only, own data)

`listBeneficiaries(ctx)`, `getBeneficiary(ctx, id)`, `createBeneficiary(ctx, { fullName,
nickname?, method: 'WALLET' | 'MOBILE_MONEY', accountNumber, providerId?, relationship? })`
(validates the BI-Rem account or the operator account), `updateBeneficiary(ctx, id, { fullName,
nickname?, relationship? })`, `archiveBeneficiary(ctx, id)`. Schema `beneficiarySchema`.

### linked accounts — `@/server/linked-accounts` (customer only, own data)

The customer's own mobile-money accounts, validated with the operator, reused for top-up and
cash-out. Stored as `beneficiaries` rows with the reserved relationship `SELF`
(`OWN_ACCOUNT_RELATIONSHIP`); the beneficiaries screens hide them. `listLinkedAccounts(ctx)`,
`getLinkedAccount(ctx, id)`, `linkMobileMoneyAccount(ctx, { providerId, accountNumber,
nickname? })` (provider must be an active operator of the customer's country; the account must
pass `validateAccount`), `unlinkAccount(ctx, id)`, `previewTopUp(ctx, { walletId, providerId,
accountNumber, amount })` → what the top-up confirmation shows (nothing stored), `isLinkedAccount(beneficiary)`, `linkAccountSchema`.

### countries — `@/server/countries`

`listCountries({ enabled? })`, `getCountry(code)`, `listRails()` — public reads.
`setCountryEnabled(ctx, code, enabled)`, `setCountryRisk(ctx, code, level)` — perm
`countries:write`.

### users — `@/server/users` (back office)

`searchUsers(ctx, { search?, role?, status?, kycStatus?, riskLevel?, countryCode?, page?,
pageSize? })` and `getUserDetail(ctx, userId)` → `{ user (with wallets + balances, kycCases,
beneficiaries, partner), transfers, alerts, activeSessions }` — perm `users:read`.
`setUserStatus(ctx, userId, status, reason)`, `unlockUser(ctx, userId)`,
`createStaffUser(ctx, { email, fullName, role, password })`, `setStaffRole(ctx, userId, role)` —
perm `users:write`. `recalculateUserRisk(ctx, userId)` — perm `aml:write` or `users:write`.

### ledger — `@/server/ledger`

`postJournal(tx, { kind, description, lines: { accountId, direction, amount }[], transferId?,
reversesJournalId?, createdById?, metadata?, postedAt? })` → `{ journalId, balances }` — locks
the accounts `FOR UPDATE` in id order, checks balance per currency, refuses negative wallets.
`lockAccounts(tx, ids)`, `reverseJournal(tx, journalId, options)`, `ensureSystemAccounts`,
`getSystemAccountId(client, type, currency)`, `getSystemAccountIds(client, currency, types)`,
`systemAccountCode(type, currency)` (`SYS:<TYPE>:<CCY>`), `getAccountBalance(id)`,
`getAccountStatement(accountId, options)`, `verifyLedgerIntegrity()` →
`{ currency, totalDebits, totalCredits, unbalancedJournals, driftingAccounts, negativeWallets,
balanced }[]`. **Pages and actions never call `postJournal`** — use the engine functions.

Account types and their natural side (the side that increases `balance`): `WALLET` (credit),
`FEE_REVENUE`, `FX_REVENUE`, `SUSPENSE`, `COMMISSION_PAYABLE`, `CAPITAL`, `FX_POSITION` (credit;
positive = long, negative = short), `SETTLEMENT` (float, debit), `COMMISSION_EXPENSE` (debit).

### fees — `@/server/fees`

`listFeeRules(ctx)` (perm `fees:read`), `saveFeeRule(ctx, { id?, name, transferType?, currency,
sourceCountry?, targetCountry?, fixedAmount, percentBps, minFee?, maxFee?, priority?, active? })`
(amounts are minor-unit strings), `setFeeRuleActive(ctx, id, active)` — perm `fees:write`.
`resolveFeeRule(client, query)`, `calculateFee(rule, amount)`, `quoteFee(client, query, amount)`,
`feeRuleSchema`, `TRANSFER_TYPES`.

### fx — `@/server/fx`

`getRate(client, base, quote)` → `{ midRate, marginBps, source, derived, updatedAt }` (scaled
bigint), `toUsdMinor(client, amount, currency)`, `fromUsdMinor(client, cents, currency)`,
`priceTransfer(client, pricingInput): Pricing`, `listFxRates(ctx, { baseCurrency?,
quoteCurrency? })` (perm `fx:read`), `setFxRate(ctx, { baseCurrency, quoteCurrency, midRate:
'1.2345', marginBps, updateInverse? })` (perm `fx:write`, audited), `createQuote(ctx, input)`,
`getQuote(ctx, quoteId)` (owner / `transfers:read`), `expireStaleQuotes()`. `Pricing { type,
deliveryMethod, sourceCountry, targetCountry, sourceCurrency, targetCurrency, sendAmount,
feeAmount, feeRuleId, fxMarginAmount, totalDebit, receiveAmount, midRate, customerRate,
marginBps, sendAmountUsd, revenueUsd }`. In UI code prefer `previewTransfer` / `quoteTransfer`
from `@/server/transfers`.

Pricing formula (send amount S in source minor units): `fee` from the fee rule;
`customerRate = floor(mid × (1 − marginBps/10⁴))`; `receive = floor(S × customerRate ×
10^(expT − expS))`; `fxMargin = round_half_up(S × marginBps/10⁴)`; `totalDebit = S + fee`.

### connectors — `@/server/connectors` (+ `/webhooks`)

Admin service (`providers.ts`): `listProviders(ctx, { countryCode?, status? })`,
`getProvider(ctx, id)`, `listProviderSecretVersions(ctx, id)`, `listProviderHealthChecks(ctx, id,
limit?)` — perm `providers:read`. `createProvider(ctx, input)`, `updateProvider(ctx, id, input)`,
`setProviderStatus(ctx, id, status)`, `setProviderCredentials(ctx, id, { field: value })` →
`{ version }`, `rotateWebhookSecret(ctx, id, secret?)` → `{ version, generatedSecret }` (shown
once) — perm `providers:write`. `testProviderConnectivity(ctx, id)` → `{ status, latencyMs,
message, simulated, checkedAt }` — perm `providers:test`. Public reads:
`listAvailableProviders({ countryCode?, currency? })` (pickers for payouts / top-ups),
`getPublicProviderStatus()`. `ProviderView` never contains secrets: `hasCredentials`,
`credentialsVersion`, `hasWebhookSecret`, `webhookSecretVersion`, `simulated`, `webhookPath`.
Schemas `providerSchema`, `credentialsSchema`; `ADAPTER_OPTIONS` for the adapter picker.

Connector layer: `WalletConnector` interface (`validateAccount`, `getBalance`, `transfer`,
`getStatus`, `reverse`, `getStatement`, `ping`; `adapter`, `simulated`), `SimulatorConnector`,
`HttpConnector`, `registerAdapter(key, factory)`, `getConnectorForProvider(providerId)`,
`SIMULATOR_SCENARIOS` (show as a sandbox cheat sheet). Simulator outcomes by the last four
digits of the account: `0000` unknown account, `0001` fails (limit), `0002` fails (blocked),
`0003` pending → success on refresh, `0004` pending → failed on refresh, `0005` timeout →
success on refresh, `0006` pending until a webhook, `0007` succeeds but cannot be reversed,
anything else succeeds.

`@/server/connectors/webhooks`: `handleProviderWebhook({ providerCode, rawBody, signature,
now? })` → `{ outcome: 'PROCESSED', transferId, transferStatus } | { outcome: 'DUPLICATE' } |
{ outcome: 'IGNORED', reason }`; throws `NOT_FOUND` / `UNAUTHENTICATED` / `VALIDATION` /
`RATE_LIMITED`. Body: `{ eventId, type?, reference?, providerRef?, status: 'SUCCESS' | 'FAILED' |
'PENDING', failureCode?, failureReason? }`. `listProviderWebhookEvents(ctx, providerId, limit?)`
— perm `providers:read`.

### kyc — `@/server/kyc`

`submitKycCase(ctx, { targetTier: 'TIER_1' | 'TIER_2', idType, idNumber, idCountry },
documents: { kind, fileName, mimeType, data: Uint8Array }[])` (customer; ≤ 1 MB each; JPEG / PNG /
WebP / PDF checked by content; `ID_FRONT` required, `PROOF_OF_ADDRESS` for tier 2),
`listMyKycCases(ctx)`, `getKycCase(ctx, id)` (owner or `kyc:read`), `getKycDocument(ctx,
documentId)` → `{ fileName, mimeType, size, sha256, data }` (owner or `kyc:review`; staff views
are audited), `listKycCases(ctx, { status?, page?, pageSize? })` (perm `kyc:read`),
`reviewKycCase(ctx, id, { decision: 'APPROVE' | 'REJECT' | 'RESUBMIT', note })` (perm
`kyc:review`), `getLimitOverview(ctx, userId?, displayCurrency?)` → tier, limits, usage and
local-currency equivalents, `getTierLimits()`, `KYC_TIER_INFO`, `KYC_ID_TYPES`,
`KYC_DOCUMENT_KINDS`, `MAX_DOCUMENT_BYTES`, `ALLOWED_DOCUMENT_TYPES`, `KYC_VENDORS`.

Simulated vendor decision by ID number: ends `0000` → REJECT, ends `9999` or contains `REVIEW`
→ REVIEW (queue), otherwise APPROVE (auto-approved when `kyc.autoApprove`). Default limits (USD):
tier 0 $50 / $100 day / $300 month, domestic only; tier 1 $1,000 / $2,500 / $10,000; tier 2
$10,000 / $25,000 / $100,000.

### aml — `@/server/aml`

Workflow (`cases.ts`): `listAlerts(ctx, { status?, severity?, userId?, page? })`,
`listCases(ctx, { status?, assignedToId?, page? })`, `getCase(ctx, id)` (subject, transfer,
alerts, notes, SARs), `listSars(ctx, { status? })`, `listAmlRules(ctx)`,
`listSanctionsEntries(ctx, { type?, search? })` — perm `aml:read`. `dismissAlert(ctx, id, note)`,
`escalateAlert(ctx, id, summary?)`, `addCaseNote(ctx, caseId, body)`, `assignCase(ctx, caseId,
assigneeId?)`, `releaseCase(ctx, caseId, note)` (completes the held transfer),
`rejectCase(ctx, caseId, note)` (refunds it), `closeCaseWithoutAction(ctx, caseId, note)`,
`updateAmlRule(ctx, ruleId, { enabled?, score?, action?, severity?, params? })` — perm
`aml:write`. `createSarDraft(ctx, caseId, narrative)`, `updateSarDraft(ctx, sarId, narrative)`,
`fileSar(ctx, sarId, { regulator, reference? })` — perm `sar:write`. `addSanctionsEntry(ctx,
input)`, `setSanctionsEntryActive(ctx, id, active)` — perm `sanctions:write`.

Engine (`engine.ts`, used by the transfer engine): `evaluateTransfer`, `recordScreening`,
`screenName(client, name, { threshold?, listType? })`, `assessUserRisk(client, userId)`,
`AML_RULE_PARAM_SCHEMAS`. Names (`names.ts`): `normalizeName`, `nameSimilarity` (0–100).
A transfer is held when a hit's rule action is `HOLD` or the summed score ≥ `aml.holdScore` (60).

### transfers — `@/server/transfers`

```ts
type RecipientInput =
  | { kind: 'WALLET'; identifier: string }                // phone, e-mail or partner code (M-…, A-…, P-…)
  | { kind: 'MOBILE_MONEY'; providerId: string; accountNumber: string; name: string }
  | { kind: 'BENEFICIARY'; beneficiaryId: string };

previewTransfer(ctx, { senderWalletId, recipient, amount }): Promise<TransferPreview>   // nothing stored
quoteTransfer(ctx, { senderWalletId, recipient, amount }): Promise<TransferPreview>     // + locked quote (15 min)
createTransfer(ctx, { senderWalletId, recipient, amount?, quoteId?, idempotencyKey,
                      purpose?, sourceOfFunds?, note? }): Promise<{ transfer, replayed }>
topUpWallet(ctx, { walletId, providerId, accountNumber, amount, idempotencyKey }): Promise<{ transfer, replayed }>
refreshTransferStatus(ctx, transferId): Promise<Transfer>      // sender / sending partner / transfers:refresh
reverseTransfer(ctx, transferId, reason): Promise<Transfer>    // perm transfers:reverse
releaseHeldTransfer(ctx, transferId, note) / rejectHeldTransfer(ctx, transferId, reason)  // perm aml:write
```

`TransferPreview { plan: { type, international, sender, recipient: { deliveryMethod, name,
account, countryCode, currency, … } }, pricing: Pricing, quoteId, expiresAt }`.

- The sender wallet must belong to the actor (user, partner user or API key of the partner).
- The type is derived: different country or currency → `INTERNATIONAL`; recipient is a merchant
  wallet → `W2M`; agent wallet → `W2A`; otherwise `W2W`. International transfers require
  `purpose` (`TRANSFER_PURPOSES`) and `sourceOfFunds` (`SOURCES_OF_FUNDS`).
- `amount` is the **send** amount in the sender wallet's currency; the fee is added on top
  (`totalDebit = amount + fee`). With `quoteId` the stored price is used (must match the plan).
- Result statuses: `COMPLETED` (wallet delivery), `PROCESSING` (mobile-money payout pending at
  the provider — call `refreshTransferStatus` or wait for a webhook), `ON_HOLD` (AML — funds
  reserved, compliance decides), `FAILED` (provider refused — refunded). Later: `REJECTED`
  (compliance — refunded), `REVERSED`.
- Idempotent per sender on `idempotencyKey` (8–100 chars `[A-Za-z0-9_.:-]`): a replay returns
  `{ transfer: <original>, replayed: true }`.
- Typical errors to surface: `NOT_FOUND` (recipient), `VALIDATION` (account, purpose),
  `INSUFFICIENT_FUNDS`, `KYC_REQUIRED` (offer the verification page), `LIMIT_EXCEEDED`,
  `QUOTE_EXPIRED`, `UNSUPPORTED` (country/provider), `PROVIDER_ERROR`.

Queries: `getTransferDetail(ctx, idOrReference)` → `{ transfer, perspective: 'SENDER' |
'RECIPIENT' | 'STAFF', events: { id, type, message, createdAt, data }[], provider }` (sender,
recipient once completed, partners involved, or `transfers:read`; recipients and customers get a
redacted transfer and no event data); `listMyTransfers(ctx, { status?, type?, direction?, from?,
to?, page?, pageSize? })` → items `{ id, reference, type, status, direction, counterpartyName,
counterpartyAccount, amount, currency, sendAmount, sourceCurrency, receiveAmount,
targetCurrency, feeAmount, createdAt, completedAt }` (works for customers, partner users and API
keys); `listTransfers(ctx, { search?, status?, type?, userId?, partnerId?, providerId?,
sourceCountry?, targetCountry?, from?, to?, page? })` and `getTransferJournals(ctx, transferId)`
— perm `transfers:read`; `getTransferCompliance(ctx, transferId)` — perm `aml:read`.

Timeline event types: `CREATED`, `SCREENED` (staff only), `HELD`, `RELEASED`, `FUNDS_RESERVED`,
`SENT_TO_PROVIDER`, `PROVIDER_PENDING`, `COMPLETED`, `FAILED`, `REJECTED`, `REFUNDED`, `REVERSED`.

### partners — `@/server/partners`

Onboarding: `applyForPartner(input, meta?)` (public; creates a PENDING partner + PARTNER login)
— schema `partnerApplicationSchema`; `createPartner(ctx, input)`, `reviewPartner(ctx, partnerId,
{ decision: 'APPROVE' | 'REJECT', commissionBps?, note? })`, `updatePartner(ctx, partnerId,
{ commissionBps?, status?: 'ACTIVE' | 'SUSPENDED' })` — perm `partners:write`;
`listPartners(ctx, { type?, status?, search?, page? })` — perm `partners:read`.

Partner-scoped (the actor's own partner; staff may pass `partnerId` with `partners:read` /
`partners:write`): `getPartner(ctx, partnerId?)`, `getPartnerDashboard(ctx, partnerId?)` →
`{ partner, wallets, commissions, last30Days: { received, sent }, activeApiKeys,
activeWebhookEndpoints, webhookDeliveries }`, `createApiKey(ctx, { name, scopes }, partnerId?)` →
`{ apiKey, secret }` (`brl_<prefix>_<random>`, shown once), `listApiKeys(ctx, partnerId?)`,
`revokeApiKey(ctx, id)`, `listCommissions(ctx, { partnerId?, status?, page? })`,
`getCommissionSummary(ctx, partnerId?)`, `listSettlements(ctx, { partnerId?, limit? })`,
`createWebhookEndpoint(ctx, { url, description?, events }, partnerId?)` → `{ endpoint, secret }`
(shown once), `listWebhookEndpoints(ctx, partnerId?)`, `setWebhookEndpointActive(ctx, id,
active)`, `deleteWebhookEndpoint(ctx, id)`, `listWebhookDeliveries(ctx, { partnerId?,
endpointId?, limit? })`, `sendTestWebhook(ctx, endpointId)`, `redeliverWebhook(ctx, deliveryId)`.
`createSettlement(ctx, { partnerId, currency })` — perm `settlements:write` (pays all accrued
commission into the partner wallet).

Public API support: `authenticateApiKey(authorizationHeader, meta?)` → `{ ctx, partner, scopes }`
(throws `UNAUTHENTICATED` / `RATE_LIMITED`; 120 requests per minute per key),
`assertApiScope(auth, scope)`; `API_KEY_SCOPES` = `transfers:read`, `transfers:write`,
`wallets:read`, `quotes:write`; `PARTNER_EVENT_TYPES` = `transfer.completed`, `transfer.failed`,
`transfer.on_hold`, `transfer.rejected`, `transfer.reversed`, `payment.received`,
`payment.reversed`, `settlement.paid`, `webhook.test`; `dispatchPartnerEvent(partnerId, type,
data)` (already called by the engine after commit). Webhook deliveries are POSTed inline with a
3 s timeout, signed `x-birem-signature: t=<unix>,v1=<hmac-sha256(secret, "<t>.<body>")>`, plus
`x-birem-event` and `x-birem-delivery`.

With an API-key `ctx`, the same service functions work: `listMyWallets(ctx)`,
`quoteTransfer`, `createTransfer`, `listMyTransfers(ctx)`, `getTransferDetail(ctx, id)`.

### reports — `@/server/reports`

`resolveRange({ days?, from?, to? })` → `{ from, to }`. Dashboards (perm `reports:read`;
treasury needs `treasury:read`): `getExecutiveDashboard(ctx, range?)` → `{ totals: { transfers,
completed, failed, onHold, processing, reversed, failureRateBps, valueUsd, revenueUsd },
activeUsers: { dau, mau }, customers: { total, new }, daily[], corridors[], countries[] }`;
`getOperationalDashboard` → `{ totals, byStatus, byType, providers (performance), stuck,
recentFailures, webhookEvents }`; `getRevenueDashboard` → `{ totals: { feeUsd, fxMarginUsd,
revenueUsd }, daily, corridors, byType, byCurrency }`; `getComplianceDashboard` → `{ kyc, risk,
alerts, cases, sars, held, flaggedCustomers }`; `getTreasuryDashboard` → `{ positions (float,
thresholds, liquidity OK/LOW/CRITICAL, walletLiabilities, suspense, fxPosition, revenues…),
alerts, fxPairs, integrity }`; `getReconciliation(ctx)` (perm `transfers:read`) → `{ integrity,
suspense, unposted, inFlight, healthy }`. USD figures are cents (`bigint`).

Exports (perm `reports:export`; `audit` also `audit:read`, `compliance` also `aml:read`,
`commissions` also `partners:read`): `exportReport(ctx, name, format, range?)` → `{ data,
contentType, fileName }` with `name` in `REPORT_NAMES` (`transfers`, `revenue`, `corridors`,
`providers`, `compliance`, `treasury`, `commissions`, `audit`) and `format` `csv` | `xlsx` |
`pdf`; `REPORT_LABELS`; lower level `buildReportTable`, `exportTable(table, format)`, `toCsv`,
`toXlsx`, `toPdf`. Serve with `fileResponse` from `@/lib/http`.

### treasury — `@/server/treasury`

`setTreasuryThreshold(ctx, { currency, lowBalance, criticalBalance })` (minor-unit strings),
`moveFloat(ctx, { currency, amount: bigint, direction: 'FUND' | 'WITHDRAW', reason })` — perm
`treasury:write`. `liquidityLevel(balance, threshold)`.

### back office — `@/server/backoffice`

`assignKycTier(ctx, userId, { tier, reason })` — manual tier assignment, perm `kyc:review`,
audited, notifies the customer (`tierAssignmentSchema`). `getProviderReconciliation(ctx, range)`
— perm `transfers:read`: per provider, the float movements booked in the ledger against the
provider's statement (for simulated providers, rebuilt from the outcomes the simulator
acknowledged), with breaks `AMOUNT_MISMATCH` / `LEDGER_ONLY` / `PROVIDER_ONLY`. Pure helpers
`netStatement`, `compareStatements`.

### receipts — `@/server/receipts`

`getReceipt(ctx, idOrReference): ReceiptData` (`{ appName, reference, status, statusLabel,
typeLabel, createdAt, completedAt, sections: { title, lines: { label, value, emphasis? }[] }[],
notes }`) for the HTML print view; `getReceiptPdf(ctx, idOrReference)` → `{ data, fileName }`.
Same access rule as `getTransferDetail`.

## 7. Data model cheat sheet

Enums (import from `@/generated/prisma/enums`): `Role`, `UserStatus`, `KycTier`, `KycStatus`,
`RiskLevel`, `KycCaseStatus`, `KycIdType`, `KycDocumentKind`, `ProviderEnvironment`,
`ProviderStatus`, `HealthStatus`, `WalletType`, `TransferType` (`W2W`, `W2M`, `W2A`,
`INTERNATIONAL`, `TOPUP`), `TransferStatus` (`PROCESSING`, `ON_HOLD`, `COMPLETED`, `FAILED`,
`REJECTED`, `REVERSED`), `DeliveryMethod` (`WALLET`, `MOBILE_MONEY`), `TransferChannel`,
`AmlRuleType`, `AmlAction`, `AmlAlertStatus`, `AmlCaseStatus`, `SarStatus`, `PartnerType`,
`PartnerStatus`, `CommissionStatus`, `SettlementStatus`, `WebhookDeliveryStatus`, `AuditOutcome`.

Tables: `users`, `sessions`, `login_attempts`, `rate_limit_buckets`, `audit_logs`,
`notifications`, `settings`, `kyc_cases`, `kyc_documents` (bytea), `beneficiaries`, `countries`,
`rails`, `providers`, `provider_secrets` (encrypted, versioned), `provider_health_checks`,
`provider_webhook_events` (unique provider + event id), `wallets`, `ledger_accounts`,
`treasury_thresholds`, `journals`, `ledger_entries`, `fee_rules`, `fx_rates`, `quotes`,
`transfers`, `transfer_events`, `aml_rules`, `aml_alerts`, `aml_cases`, `aml_case_notes`,
`sar_reports`, `sanctions_entries`, `partners`, `api_keys`, `webhook_endpoints`,
`webhook_deliveries`, `commissions`, `settlements`.

Database-level guards (in the initial migration): wallets cannot go below zero (CHECK), entries
are positive, a deferred trigger checks every journal balances per currency at commit, and the
four append-only tables reject UPDATE / DELETE.

How a transfer posts:

```
wallet → wallet, clean        1 tx:  DR sender (send+fee) | CR fee revenue | CR recipient           → COMPLETED
cross-currency                same journal, two legs: … CR FX revenue, CR FX position(src) |
                              DR FX position(tgt), CR recipient(tgt)
mobile-money payout           tx 1:  DR sender | CR suspense                                         → PROCESSING
                              provider call (after commit)
                              tx 2:  DR suspense | CR fee, FX…, CR settlement/float(tgt)             → COMPLETED
                                 or  DR suspense | CR sender                                          → FAILED
AML hold                      tx 1:  DR sender | CR suspense                                         → ON_HOLD
                              release: as tx 2 above (or provider dispatch) / reject: refund         → REJECTED
commission                    with the settlement journal: DR commission expense | CR commission payable
top-up                        after the provider confirms: DR settlement/float | CR wallet (| CR fee)
reversal                      mirror journal of every journal of the transfer                        → REVERSED
```

## 8. Running: database, dev server, tests, e2e

```bash
createdb -h localhost -U birem birem_lite            # once
export DATABASE_URL=postgresql://birem:birem@localhost:5432/birem_lite

pnpm --filter @bi-rem/lite generate          # Prisma client → src/generated/prisma (needed before tsc/build)
pnpm --filter @bi-rem/lite migrate:deploy    # apply migrations
pnpm --filter @bi-rem/lite seed              # reference data + admin + demo data (idempotent)
pnpm --filter @bi-rem/lite dev               # http://localhost:3002

pnpm --filter @bi-rem/lite lint
pnpm --filter @bi-rem/lite typecheck
pnpm --filter @bi-rem/lite test                    # vitest: unit + integration
pnpm --filter @bi-rem/lite build
pnpm --filter @bi-rem/lite test:e2e                # Playwright suite (self-contained)
pnpm --filter @bi-rem/lite test:e2e:walkthroughs   # area walk-throughs (self-contained)
```

Development falls back to fixed `AUTH_SECRET` / `ENCRYPTION_KEY` values (with a warning), so
only `DATABASE_URL` is required locally. To run a second server next to the first, give it its
own dist dir and port: `NEXT_DIST_DIR=.next-b npx next dev -p 3102`.

All test commands create and drop their own databases through `TEST_DATABASE_ADMIN_URL`
(default `postgresql://birem:birem@localhost:5432/postgres`; the role must be allowed to
`CREATE DATABASE`). None of them touches the database in `DATABASE_URL`.

**Vitest.** Each run creates its own template database (migrations + reference data, no demo
data) and every integration test file clones it, so runs never collide.

```ts
// tests/integration/my-area.test.ts
import { describe, expect, it } from 'vitest';
import { createTransfer } from '@/server/transfers';
import { withTestDatabase } from '../helpers/db';
import { createCustomer, createPartner, createStaff, idem, providerId, walletBalance, systemBalance, fundWallet } from '../helpers/factories';

withTestDatabase(); // top of the file: own database for this file

it('…', async () => {
  const sender = await createCustomer({ country: 'CM', tier: 'TIER_2', balance: 500_000n }); // .ctx is its ActionContext
  const staff = await createStaff('COMPLIANCE');                                              // .ctx
  const merchant = await createPartner({ type: 'MERCHANT', commissionBps: 30 });              // .ctx, .code, .walletId
  const { transfer } = await createTransfer(sender.ctx, { …, idempotencyKey: idem() });
  expect(await walletBalance(sender.walletId)).toBe(…);
});
```

Unit tests go in `tests/unit/*.test.ts`. Route handlers and actions are best tested through the
service they call plus an e2e spec.

**End-to-end suite** (`tests/e2e/*.spec.ts`, `@playwright/test`, config
`tests/e2e/playwright.config.ts`). One command does everything: the `webServer` builds the app
and serves it with `next start` (production mode, production rate limits) on port 3210; the
global setup creates the database `birem_lite_e2e`, runs `prisma migrate deploy` and the real
seed with the demo data, and waits for `/api/health`; the global teardown drops the database.

| File                        | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.setup.ts`             | signs in once per demo account and stores the session (`tests/e2e/.auth/`)                                                                                                                                                                                                                                                                                                                                                                                             |
| `10-golden-path.spec.ts`    | one story across the phases: register → KYC → compliance approves → link a mobile-money account and top up → domestic transfer → international transfer CM → AO on a locked quote → transfer held by screening → compliance releases → FX margin changed and the next quote reflects it to the cent → provider connectivity test → partner API key and an idempotent API transfer → CSV / Excel / PDF exports. Balances are checked to the minor unit after every step |
| `20-access-control.spec.ts` | other customers' transfers, receipts, statements and documents are not found; each area is closed to the other roles; back-office pages, navigation and exports follow the permission map; a captured server action replayed with another session changes nothing                                                                                                                                                                                                      |
| `30-public.spec.ts`         | `/roadmap` (13 phases), `/status`, `/api/health`, security headers, PWA manifest, 390 px layouts, real 404                                                                                                                                                                                                                                                                                                                                                             |
| `90-link-crawl.spec.ts`     | follows every internal link signed out and as eight accounts; fails on 4xx / 5xx, on a rendered not-found or error boundary (`data-page-state`), and on any link that signs the user out                                                                                                                                                                                                                                                                               |

Variables (see `tests/e2e/env.ts`): `E2E_BASE_URL` runs the suite against an existing instance
instead (nothing is built or created; it must hold the demo data — and the suite changes it);
`E2E_SKIP_BUILD=1` reuses the current build; `E2E_PORT`, `E2E_DATABASE_NAME`,
`E2E_KEEP_DATABASE=1`. Chromium comes from `playwright install chromium`; `@playwright/test` is
pinned to an exact version so the browser revision is stable. Failures leave a trace and a
screenshot in `test-results/`.

Writing a spec: import `test` / `expect` from `./support`; `session('amina')` opens a page signed
in as that demo account (never sign in again — the production login limits apply);
`pageState(page)` tells `'ok' | 'not-found' | 'error'`, because pages stream and a missing object
can arrive with status 200; pages opened through `session` fail the test on any uncaught browser
error or 5xx response.

**Walk-throughs** (`tests/e2e/walkthroughs/*.e2e.mjs`, plain Playwright library): four long
scripted sessions written with the areas — `core`, `customer`, `admin`, `partner` — covering
MFA, sessions, KYC rejection and resubmission, SAR filing, provider secrets and signed provider
webhooks, partner webhook deliveries with a local receiver, agent cash-in and every export.
`run.mjs` seeds a template database, starts `next dev` on port 3220 (`.next-walkthroughs`) and
gives each walk-through a fresh copy, because each one changes the demo data and signs in many
times (development rate limits are ×20). A walk-through default-exports
`async ({ browser, baseUrl, check, login }) => { … }`.

## 9. Seeded data

Always (`seedReferenceData`): 18 countries — enabled: CM, GA, TD, CG, CF, GQ (XAF), AO (AOA),
MZ (MZN), CV (CVE), GW (XOF), ST (STN); planned/disabled: NG, GH, KE, UG, TZ, RW, ZA. Country
risk (illustrative): CF high; TD, GW, NG medium. 23 providers, all `simulator` / SANDBOX —
active: `mtn-momo-cm`, `orange-money-cm`, `airtel-money-ga`, `moov-money-ga`, `airtel-money-td`,
`moov-money-td`, `mtn-momo-cg`, `airtel-money-cg`, `orange-money-cf`, `orange-money-gq`,
`unitel-money-ao`, `m-pesa-mz`, `e-mola-mz`, `orange-money-gw`, `mtn-momo-gw`; inactive (planned
countries): `mtn-momo-ng`, `mtn-momo-gh`, `m-pesa-ke`, `airtel-money-ke`, `mtn-momo-ug`,
`m-pesa-tz`, `mtn-momo-rw`, `mtn-momo-za`. Cabo Verde and São Tomé have no mobile-money
provider: wallet delivery only. 9 planned rails. FX rates for every ordered pair of the 15
currencies (EUR peg 655.957 for XAF/XOF; margins 50–175 bps). Fee rules per currency: W2W 50 bps
(min/max), W2M 75 bps, W2A 150 bps, INTERNATIONAL 1 unit + 150 bps, TOPUP free. System ledger
accounts per currency with float thresholds. AML rules `AML-001` large transfer ≥ $3,000 (HOLD),
`AML-002` ≥ $700 (FLAG), `AML-010` > 5 transfers / hour, `AML-011` > $5,000 / 24 h, `AML-020`
structuring (HOLD), `AML-030` new account ≥ $500, `AML-040` high-risk corridor ≥ $200, `AML-050`
sanctions match (HOLD), `AML-051` PEP match (FLAG). A fictional screening list (e.g. "Viktor Demo
Sanctionov", "Honorable Sample Ministro").

Administrator: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (defaults `admin@bi-rem.local` /
`ChangeMe123!`); created once, never modified afterwards.

Demo data (`SEED_DEMO_DATA`, default on outside production) — password `ChangeMe123!` for all:

| Login                     | Role       | Notes                                                |
| ------------------------- | ---------- | ---------------------------------------------------- |
| `admin@bi-rem.local`      | ADMIN      |                                                      |
| `compliance@bi-rem.local` | COMPLIANCE |                                                      |
| `treasury@bi-rem.local`   | TREASURY   |                                                      |
| `support@bi-rem.local`    | SUPPORT    |                                                      |
| `partner@bi-rem.local`    | PARTNER    | demo merchant `M-DEMO01` (30 bps commission)         |
| `agent@bi-rem.local`      | PARTNER    | demo agent `A-DEMO01` (40 bps): float, cash-in / out |
| `amina@example.com`       | CUSTOMER   | CM, tier 2, funded XAF wallet, phone `+237699000101` |
| `samuel@example.com`      | CUSTOMER   | CM, tier 1, phone `+237677000104`                    |
| `joao@example.com`        | CUSTOMER   | AO, tier 1, AOA wallet                               |
| `maria@example.com`       | CUSTOMER   | MZ, tier 0, KYC case waiting in the review queue     |
| `paul@example.com`        | CUSTOMER   | GA, tier 1                                           |
| `fatou@example.com`       | CUSTOMER   | GW (XOF), tier 1                                     |

Also: API partner `P-DEMO01` (20 bps, funded wallet) without a login; opening floats (the STN float is deliberately low → treasury alert); about 100 money
movements over the last 30 days created through the engine — completed domestic and
international transfers, three provider failures, one payout still `PROCESSING` (account
`…0006`), two transfers `ON_HOLD` with open cases, one hold released, one rejected (with a SAR
draft), one open PEP alert, one reversal, API disbursements, one paid commission settlement and
further accrued commissions.

Good accounts to try by hand: pay merchant `M-DEMO01` or agent `A-DEMO01`; send to
`joao@example.com` (XAF → AOA); mobile-money payouts to any number (use the simulator suffixes
above to force outcomes); a name close to "Viktor Demo Sanctionov" to trigger a hold.

## 10. Known gaps

- Top-ups are not screened by the AML engine and are not counted in KYC limits.
- `HttpConnector` is a generic JSON adapter that has not been exercised against any real
  operator; it is covered only by type checks.
- Partner webhooks are delivered inline, once (no retry queue); `redeliverWebhook` is manual
  (the "Retry" button of `/partner/webhooks`).
- The public API has no per-IP limit for requests with an invalid key (keys are 256-bit random,
  so guessing is not practical; valid keys are limited to 120 requests / minute each).
- Agent cash-out is "customer pays the agent code, agent verifies the reference": the portal
  does not record that the cash was handed over, so paying a reference twice is prevented by the
  agent's own cash sheet, not by the system.
- TOTP has no recovery codes and does not track used codes within their 30-second step.
- Reversing a transfer whose commission was already settled leaves the paid commission with the
  partner (documented behaviour, no claw-back).
- Outbound URL checks (provider base URLs, partner webhooks) resolve DNS once before the
  request; they do not pin the resolved address (DNS-rebinding is not mitigated).
- No service worker: the PWA is installable (manifest + icons) but not offline-capable.
- English only; strings live in components, ready to be extracted for fr / pt.
- The Content Security Policy allows inline scripts and styles (`'unsafe-inline'`): Next.js
  injects inline bootstrap scripts and Lite does not issue per-request nonces.
- With `SEED_DEMO_DATA=true` every demo account — demo staff included — has the public demo
  password. That is intended for a demonstration deployment and nothing else.
- The deployment path is rehearsed against a local PostgreSQL 16 (`vercel-build` twice on an
  empty database, then `next start`); it has not been run on Vercel or against Neon from here.
- The back office has no error boundary of its own: a crashed back-office page falls back to
  the root "Something went wrong" page, without the navigation.
