# @bi-rem/api

NestJS 12 backend for BI-Rem (Phase 1 foundation): authentication, RBAC, audit trail,
notifications, platform configuration and observability. REST under `/v1`, OpenAPI at `/docs`.

The package is an ES module (`"type": "module"`, NodeNext) because `@bi-rem/db` is ESM-only;
decorator metadata is emitted by `tsc` through `nest build`.

## Run

```bash
cp .env.example .env                      # or rely on the repo root .env
pnpm --filter @bi-rem/api dev             # nest start --watch, port 4000
pnpm --filter @bi-rem/api build && pnpm --filter @bi-rem/api start:prod
pnpm --filter @bi-rem/api lint|typecheck|test|test:e2e
```

Without `REDIS_URL` the API runs with in-process fallbacks (notification dispatcher, permission
cache); without a reachable database it still boots so `/health/live`, `/docs` and `/metrics`
work and `/health/ready` reports the outage. Every environment variable is documented in
`.env.example` and validated at boot by `src/config/env.ts` (Zod).

## Module map

| Path                              | Module                         | Responsibility                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main.ts`, `src/bootstrap.ts` | —                              | Sentry/OTel bootstrap, Nest factory, helmet, CORS, `/v1` prefix, ValidationPipe, Swagger, shutdown hooks                                                                                                                                                           |
| `src/config/env.ts`               | `ConfigModule`                 | Zod-validated environment → `AppConfig`                                                                                                                                                                                                                            |
| `src/common/`                     | —                              | `RequestContext` (AsyncLocalStorage, correlation id/actor/audit snapshots), `ProblemDetailsFilter` (RFC 9457), pagination helpers, `ApiException` with stable `code`s, decorators `@Public() @Permissions() @AnyPermission() @CurrentUser() @Audit() @SkipAudit()` |
| `src/prisma/`                     | `PrismaModule` (global)        | `PrismaService` wrapping `createPrismaClient` from `@bi-rem/db`                                                                                                                                                                                                    |
| `src/redis/`                      | `RedisModule` (global)         | Optional shared ioredis client (`REDIS_CLIENT`, `null` when unset)                                                                                                                                                                                                 |
| `src/modules/crypto/`             | `CryptoModule` (global)        | AES-256-GCM field encryption (`ENCRYPTION_KEY`), SHA-256, constant-time compare                                                                                                                                                                                    |
| `src/modules/auth/`               | `AuthModule`                   | Register/login (realm), argon2id, lockout, JWT access + rotating opaque refresh tokens with reuse detection, logout, password reset/change, TOTP MFA (otplib, encrypted secret), `JwtStrategy`, global `JwtAuthGuard` (bearer or `x-api-key`)                      |
| `src/modules/rbac/`               | `RbacModule` (global)          | Roles CRUD, permission catalogue, user↔role assignment, `PermissionResolverService` (60 s cache: in-memory or Redis), global `PermissionsGuard` (SUPER_ADMIN bypass, API-key scope wildcards)                                                                      |
| `src/modules/users/`              | `UsersModule`                  | Admin user management (list/filter, create + invitation, update, suspend/reactivate, unlock, soft delete) and `/users/me` profile                                                                                                                                  |
| `src/modules/audit/`              | `AuditModule` (global)         | `AuditLogService.record()`, global `AuditInterceptor` (every non-GET request, redaction), `GET /v1/audit`                                                                                                                                                          |
| `src/modules/notifications/`      | `NotificationsModule` (global) | `NotificationService.send()` → template render (`{{var}}`) → `Notification` row → queue (`BullMQ` or in-process) → `NotificationProcessor` → providers (`EmailProvider` SMTP, `LoggingSmsProvider` stub, `InAppProvider`); preferences; templates admin            |
| `src/modules/feature-flags/`      | `FeatureFlagsModule`           | CRUD + `isEnabled(key, ctx)` with rules and stable percentage rollout, 30 s cache                                                                                                                                                                                  |
| `src/modules/settings/`           | `SettingsModule`               | CRUD, secret values encrypted at rest and redacted, `getValue()/getNumber()` for services                                                                                                                                                                          |
| `src/modules/api-keys/`           | `ApiKeysModule`                | Service-account keys (`brk_live_…`, SHA-256 stored, plaintext returned once), scopes                                                                                                                                                                               |
| `src/modules/outbox/`             | `OutboxModule` (global)        | `OutboxService.publish(event, tx)` + `OutboxRelay` (`@Interval` 10 s, `FOR UPDATE SKIP LOCKED`, log transport in Phase 1)                                                                                                                                          |
| `src/modules/monitoring/`         | `MonitoringModule`             | Terminus `/health`, `/health/live`, `/health/ready` (Prisma + Redis), prom-client `/metrics` with `http_request_duration_seconds`, Sentry init, `src/tracing.ts` OTel bootstrap                                                                                    |

Global guard order: `ThrottlerGuard` → `JwtAuthGuard` → `PermissionsGuard`. Global interceptors:
`MetricsInterceptor`, `AuditInterceptor`, `LoggerErrorInterceptor`. Logging is `nestjs-pino`
with `x-request-id` as the request id (accepted or generated, always echoed).

## Endpoints

Operational endpoints are unprefixed; everything else lives under `/v1`. "Auth" is the
required caller: `public`, `user` (any authenticated user), a permission key, or `api-key`
(an API key whose scopes cover the permission). All mutating requests are audited.

| Method      | Path                                          | Auth                           | Notes                                                                                                         |
| ----------- | --------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| GET         | `/health`, `/health/live`, `/health/ready`    | public                         | Terminus reports                                                                                              |
| GET         | `/metrics`                                    | public                         | Prometheus text format                                                                                        |
| GET         | `/docs`, `/docs-json`                         | public                         | Swagger UI / OpenAPI 3                                                                                        |
| POST        | `/v1/auth/register`                           | public (10/min)                | Customer realm; returns tokens                                                                                |
| POST        | `/v1/auth/login`                              | public (10/min)                | `realm` defaults to CUSTOMER; tokens or `{ mfaRequired, mfaToken }`                                           |
| POST        | `/v1/auth/admin/login`                        | public (10/min)                | ADMIN realm                                                                                                   |
| POST        | `/v1/auth/mfa/verify`                         | public (10/min)                | Completes an MFA login                                                                                        |
| POST        | `/v1/auth/refresh`                            | public (30/min)                | Rotates refresh token; reuse revokes the family                                                               |
| POST        | `/v1/auth/logout`                             | user                           | Current session, given token, or `allDevices`                                                                 |
| GET         | `/v1/auth/me`                                 | user                           | Profile + roles + permissions                                                                                 |
| POST        | `/v1/auth/password/reset/request`             | public (10/min)                | Always 202                                                                                                    |
| POST        | `/v1/auth/password/reset/confirm`             | public (10/min)                | Single-use token; revokes sessions                                                                            |
| POST        | `/v1/auth/password/change`                    | user                           | Signs out other devices                                                                                       |
| POST        | `/v1/auth/mfa/setup` · `/enable` · `/disable` | user                           | TOTP enrolment lifecycle                                                                                      |
| GET/PATCH   | `/v1/users/me`                                | user                           | Own profile                                                                                                   |
| GET         | `/v1/users`, `/v1/users/:id`                  | `users:read`                   | Filters: realm, status, search, roleId, dates…                                                                |
| POST        | `/v1/users`                                   | `users:write`                  | Admin-created account, e-mails an invitation                                                                  |
| PATCH       | `/v1/users/:id`                               | `users:write`                  |                                                                                                               |
| POST        | `/v1/users/:id/suspend` · `/reactivate`       | `users:suspend`                | Body `{ reason }`                                                                                             |
| POST        | `/v1/users/:id/unlock`                        | `users:unlock`                 | Clears failed-login lockout                                                                                   |
| DELETE      | `/v1/users/:id`                               | `users:delete`                 | Soft delete, body `{ reason }`                                                                                |
| GET         | `/v1/users/:id/roles`                         | `users:read`                   |                                                                                                               |
| PUT         | `/v1/users/:id/roles`                         | `roles:assign`                 | Replace role set `{ roleIds }` (SUPER_ADMIN membership can only be changed by a SUPER_ADMIN user)             |
| POST/DELETE | `/v1/users/:id/roles/:roleId`                 | `roles:assign`                 | Assign / unassign one role (same SUPER_ADMIN rule)                                                            |
| GET         | `/v1/roles`, `/v1/roles/:id`                  | `roles:read`                   |                                                                                                               |
| POST        | `/v1/roles`                                   | `roles:write`                  |                                                                                                               |
| PATCH       | `/v1/roles/:id`                               | `roles:write`                  | System roles cannot be renamed                                                                                |
| DELETE      | `/v1/roles/:id`                               | `roles:delete`                 | Non-system roles only                                                                                         |
| GET         | `/v1/permissions`                             | `permissions:read`             | Catalogue (`@bi-rem/db` PERMISSIONS ∪ table)                                                                  |
| GET         | `/v1/audit`, `/v1/audit/:id`                  | `audit:read`                   | Filters: actorId, action, resource, resourceId, outcome, correlationId, from, to                              |
| GET         | `/v1/notifications/me`                        | user                           | Own notifications (`unreadOnly=true`)                                                                         |
| POST        | `/v1/notifications/me/:id/read`               | user                           |                                                                                                               |
| GET/PUT     | `/v1/notifications/preferences`               | user                           | Per-channel opt-out                                                                                           |
| GET         | `/v1/notifications`                           | `notifications:read`           | Cross-user listing                                                                                            |
| POST        | `/v1/notifications`                           | `notifications:send`           | Ad-hoc templated send                                                                                         |
| GET         | `/v1/notifications/templates`                 | `notification-templates:read`  |                                                                                                               |
| PUT         | `/v1/notifications/templates`                 | `notification-templates:write` | Upsert by key+channel+locale                                                                                  |
| GET         | `/v1/notifications/queue`                     | `system:read`                  | Queue statistics                                                                                              |
| GET         | `/v1/feature-flags/evaluate`                  | user                           | Flag map for the caller                                                                                       |
| GET         | `/v1/feature-flags`, `/v1/feature-flags/:key` | `feature-flags:read`           |                                                                                                               |
| PUT         | `/v1/feature-flags/:key`                      | `feature-flags:write`          | `{ enabled, rolloutPercentage, rules, description }`                                                          |
| DELETE      | `/v1/feature-flags/:key`                      | `feature-flags:delete`         |                                                                                                               |
| GET         | `/v1/settings`, `/v1/settings/:key`           | `settings:read`                | Secret values redacted                                                                                        |
| GET         | `/v1/settings/:key/reveal`                    | `settings:read-secrets`        |                                                                                                               |
| PUT         | `/v1/settings/:key`                           | `settings:write`               | `{ value, isSecret, description }`                                                                            |
| DELETE      | `/v1/settings/:key`                           | `settings:write`               |                                                                                                               |
| GET         | `/v1/api-keys`, `/v1/api-keys/:id`            | `api-keys:read`                | Metadata only                                                                                                 |
| POST        | `/v1/api-keys`                                | `api-keys:write`               | Returns the plaintext key once; scopes must be within the creator's own permissions (`*` is SUPER_ADMIN-only) |
| DELETE      | `/v1/api-keys/:id`                            | `api-keys:revoke`              |                                                                                                               |

Errors are `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Authentication required",
  "code": "UNAUTHENTICATED",
  "instance": "/v1/auth/me",
  "correlationId": "…",
  "timestamp": "…"
}
```

## Tests

- `pnpm --filter @bi-rem/api test` — Jest unit tests (ESM mode via `--experimental-vm-modules`):
  AuthService (lockout, rotation, reuse detection, reset tokens), PermissionsGuard,
  AuditInterceptor + redaction, CryptoService, template rendering + NotificationService,
  feature-flag rollout.
- `pnpm --filter @bi-rem/api test:e2e` — boots the app through the Nest testing module with
  `PrismaService` stubbed (`test/e2e-server.mjs`, compiled `dist/`, built on demand) and drives
  it with supertest: health, 401 problem documents, validation, metrics, OpenAPI. No database or
  Redis is needed. The server runs in a child Node process because Jest on Node 22 cannot
  `require()` the ESM `@nestjs/common` v12 from the CommonJS `@nestjs/throttler`.

## Phase 1 scope notes

- SMS delivery is a logging stub (`LoggingSmsProvider`); real gateways arrive in Phase 2.
- MFA enrol/verify/disable is complete; enforcement for the ADMIN realm (`auth.mfa.enforce-admin`)
  and recovery codes are Phase 2 (schema v1 has no recovery-code storage).
- Password-reset and invitation tokens are signed JWTs bound to the current password hash
  (single use without a token table); e-mail verification tokens follow the same pattern later.
- The outbox relay logs events; a broker transport replaces `LogOutboxTransport` in Phase 2.
