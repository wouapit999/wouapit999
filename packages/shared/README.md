# @bi-rem/shared

Framework-agnostic code shared by `@bi-rem/api`, `@bi-rem/web` and `@bi-rem/admin`:
Zod 4 schemas with inferred DTO types, platform constants and pure utilities. ESM only,
compiled with `tsc` to `dist/`.

## Entry points

| Import                     | Contents                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@bi-rem/shared`           | Everything below                                                                                                    |
| `@bi-rem/shared/constants` | Countries, currencies, locales, realms/enums, permissions, feature-flag & setting keys, API routes                  |
| `@bi-rem/shared/schemas`   | Zod schemas + types for auth, users, RBAC, audit, notifications, feature flags/settings, envelopes, Problem Details |
| `@bi-rem/shared/utils`     | Money (bigint minor units), E.164 phone normaliser, ids/correlation ids, dates/durations                            |

```ts
import { registerSchema, type RegisterDto } from '@bi-rem/shared/schemas';
import { toMinorUnits, formatMoney } from '@bi-rem/shared/utils';
import { API_ROUTES, PERMISSIONS } from '@bi-rem/shared/constants';

const dto: RegisterDto = registerSchema.parse(body);
const fee = toMinorUnits('1.50', 'USD'); // 150n
```

## Conventions baked in

- **Money** is `bigint` minor units + ISO-4217 code, matching the `BIGINT` + `currency` columns.
  Decimal strings are the only human-facing form; `number` is never used for amounts. Amounts
  cross JSON as digit strings (`minorUnitsSchema` / `serializeMoney`).
- **Ids** are UUIDs; `resolveCorrelationId` implements the `x-request-id` accept-or-generate rule.
- **Enum mirrors** (`USER_REALMS`, `USER_STATUSES`, `NOTIFICATION_*`, `AUDIT_OUTCOMES`) must stay
  in sync with the Prisma enums in `packages/db`; the database schema is the source of truth.
- **Permissions** are `resource:action` keys of the `PERMISSIONS` record (`PERMISSION_KEYS` lists them); this
  catalogue is the single source of truth — `@bi-rem/db` re-exports it and the seed writes it to the database
  so the seed and admin portal stay consistent.
- Request schemas are `.strict()` (unknown keys rejected); list queries coerce query-string
  values and restrict `sortBy` to an allow-list; PATCH bodies require at least one field.
- Use `z.input<typeof schema>` for what clients send and `z.infer` for what the API receives
  (after defaults/transforms).

## Scripts

```bash
pnpm --filter @bi-rem/shared build      # tsc -p tsconfig.build.json → dist/
pnpm --filter @bi-rem/shared dev        # tsc --watch
pnpm --filter @bi-rem/shared lint       # eslint (type-aware, preset from @bi-rem/config)
pnpm --filter @bi-rem/shared typecheck  # tsc --noEmit (includes tests)
pnpm --filter @bi-rem/shared test       # vitest run
pnpm --filter @bi-rem/shared clean
```

Tests live next to the code in `__tests__/` folders and are excluded from the build.

## Phone normalisation scope

`normalizePhone` is dependency-free and validates calling code + national-number length for
the supported countries only (see `COUNTRIES`). It strips trunk prefixes (`0803…` → `+234803…`)
and handles `00` international prefixes. Carrier-level validation happens at the SMS provider.
