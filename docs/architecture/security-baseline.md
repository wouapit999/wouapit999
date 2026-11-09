# Security baseline — Phase 1

> The controls every later phase inherits, stated as what the code and configuration do today,
> where each control lives, and what is still open. Vulnerability reporting and response are in
> [`SECURITY.md`](../../SECURITY.md); secret handling in
> [`environment-management.md`](./environment-management.md) and
> [`infra/scripts/rotate-secrets.md`](../../infra/scripts/rotate-secrets.md).

## 1. Threat model summary

| Asset                               | Threats considered in Phase 1                                          | Primary controls (§ below) |
| ----------------------------------- | ---------------------------------------------------------------------- | -------------------------- |
| Customer and admin credentials      | Credential stuffing, brute force, phishing, password reuse             | 2.1, 2.2, 2.4              |
| Session tokens                      | XSS exfiltration, token replay, refresh-token theft                    | 2.3, 3.1                   |
| Admin privileges                    | Privilege escalation, over-broad roles, insider misuse                 | 2.5, 4                     |
| PII (names, e-mail, phone, country) | Leakage through logs, error reports, API responses; unlawful retention | 5, 6                       |
| Secrets (keys, DSNs, DB URLs)       | Commit to git, exposure in CI logs or images, long-lived tokens        | 6, 7                       |
| Supply chain                        | Malicious or vulnerable dependencies, tampered images                  | 7                          |
| Availability                        | Request floods, slow queries, dependency outages                       | 3.2, 8                     |

## 2. Identity and access

### 2.1 Passwords

- Argon2id (`argon2`, memory 19 456 KiB, 2 iterations) in `PasswordService`; hashes are never
  returned by any API.
- Policy enforced on the API and mirrored in the portals through `@bi-rem/shared`
  `strongPasswordSchema`: 12–128 characters with upper- and lower-case letters, a digit and a
  symbol (`IsStrongPasswordPolicy` decorator on register, reset and change DTOs).
- Password reset uses single-purpose signed tokens (`TokenService.verifyPurposeToken(…, 'password_reset')`)
  delivered by e-mail (`password-reset` template); the request endpoint always answers `202` so
  account existence is not disclosed. Completing a reset on a `PENDING` account also marks the
  e-mail verified and activates it.

### 2.2 Lockout and rate limits

- Failed logins increment `users.failed_login_attempts`; after `auth.max-failed-login-attempts`
  (default 5, admin-editable setting) the account is locked for `auth.lockout-minutes` (default 15) and the API answers `423 ACCOUNT_LOCKED`. Successful login resets the counter.
- `@nestjs/throttler` is a global guard (300 requests/min per IP). Credential endpoints
  (`register`, `login`, `admin/login`, `mfa/verify`, password reset request/confirm) are limited to
  10/min, `refresh` to 30/min. Behind Fly/Vercel the API trusts one proxy hop (`trust proxy = 1`)
  so the client IP is the real one.

### 2.3 Tokens and sessions

- Access tokens are JWTs signed with `JWT_ACCESS_SECRET` (HS256, 15 min, `realm` claim); refresh
  tokens are 256-bit opaque strings stored only as SHA-256 hashes with IP and user agent.
- Rotation on every refresh: the presented token is revoked and linked to its successor
  (`replaced_by_token_id`). Presenting a revoked or already-rotated token revokes the entire family,
  writes an `auth.refresh.reuse-detected` audit row and returns `TOKEN_REVOKED`. Losing a race with
  a concurrent rotation is treated as reuse.
- Portals never expose tokens to page scripts: route handlers set `birem_access` (`httpOnly`,
  `Secure` in production, `SameSite=Lax`, path `/`) and `birem_refresh` (`httpOnly`, `Secure`,
  `SameSite=Strict`, path `/api/auth`). The proxy route (`/api/proxy/v1/*`) converts the cookie to a
  Bearer header and refuses to forward the session endpoints; `proxy.ts` (Next middleware)
  redirects unauthenticated navigation to the refresh handler or `/login`.
- Logout revokes the presented refresh token or, with `allDevices`, every open session of the
  user, and the portal handler clears both cookies.

### 2.4 Multi-factor authentication

- TOTP (RFC 6238, `otplib`) with secrets encrypted by `CryptoService` (AES-256-GCM, key =
  `ENCRYPTION_KEY`, AAD bound to the user id) and never returned after setup. Enabling requires a
  valid code; disabling requires the current password.
- Admin login returns `{ mfaRequired, mfaToken }` (short-lived purpose token) when MFA is on; the
  second step is `POST /v1/auth/mfa/verify`. Settings `admin.mfa-required` and
  `customer.mfa-required` and flag `auth.mfa.enforce-admin` let operators make it mandatory per realm.

### 2.5 Authorisation

- RBAC with `resource:action` permission keys. `PermissionsGuard` runs after `JwtAuthGuard` and
  checks `@Permissions()` metadata against the caller's resolved permission set (roles ∪ role
  permissions, 60 s cache in memory or Redis, invalidated on role changes). Denied requests return
  `403` and are audited with outcome `DENIED`.
- Realm separation: admin endpoints require realm `ADMIN`; the customer portal only ever obtains
  realm `CUSTOMER` tokens. The same e-mail can exist once per realm.
- System roles are seeded and immutable from the UI; the catalogue of permissions is a single
  TypeScript source (`@bi-rem/shared`), so an unknown permission string fails the typecheck.
- Service accounts authenticate with `x-api-key` (`brk_live_…` prefix, SHA-256 hash lookup, expiry and
  revocation checks, `last_used_at` touch). Scopes are a subset of the permission catalogue and
  cannot exceed the creating admin's own permissions.
- Secret settings are only revealed to callers with `settings:read-secrets`; every other reader
  gets a redacted value.

## 3. Transport and application hardening

### 3.1 API (`apps/api`)

| Control                 | Implementation                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TLS                     | Fly `force_https = true`; Vercel TLS; Neon and Redis URLs use `sslmode=require` / `rediss://`.                                                                                         |
| Headers                 | Helmet defaults (HSTS, `X-Content-Type-Options`, `Referrer-Policy`, frameguard…); CSP enabled in production. `x-powered-by` disabled.                                                  |
| CORS                    | Explicit allowlist from `CORS_ORIGINS`, credentials allowed, limited methods and headers, `x-request-id` exposed.                                                                      |
| Input validation        | Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` + `transform` (no implicit conversion); unknown fields are rejected with field-level errors.                         |
| Output                  | RFC 9457 problem details with stable `code`; stack traces never leave the process; health reports pass through unchanged.                                                              |
| Request identity        | `x-request-id` accepted or generated, propagated to logs, audit rows and responses.                                                                                                    |
| Database                | Prisma parameterised queries only; `pg` driver adapter; soft deletes; append-only audit table.                                                                                         |
| Dependencies at runtime | Multi-stage image with pruned production dependencies, non-root user `birem` (uid 1001), `tini` as PID 1, `HEALTHCHECK`, read-only root filesystem and `no-new-privileges` in compose. |

### 3.2 Portals (`apps/web`, `apps/admin`)

| Control        | Implementation                                                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSP            | `default-src 'self'`; `script-src 'self' 'unsafe-inline'` (Next bootstrap — nonce hardening pending); `connect-src 'self' <API origin>`; `frame-ancestors 'none'`; `object-src 'none'`; `upgrade-insecure-requests`. |
| Other headers  | HSTS (2 years, preload), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy`, admin `X-Robots-Tag: noindex`.            |
| BFF proxy      | Path validation (`lib/server/proxy-path.ts`), blocked session endpoints, server-only API base URL (`API_INTERNAL_URL`).                                                                                              |
| Env validation | `NEXT_PUBLIC_*` validated at build time; server variables lazily and never imported by client code (`getServerEnv` throws in the browser).                                                                           |
| Admin exposure | Vercel Authentication on preview deployments; production behind the application login; permission-aware navigation (`useCan`, `<Can>`, `<PermissionGate>`) backed by server-side guards.                             |

## 4. Audit trail

- `AuditInterceptor` records every non-GET request (success, failure and denied) with actor (user,
  API key or system), action, resource type/id, redacted before/after, IP, user agent and
  correlation id. `@Audit()` sets the action name (`auth.login`, `auth.refresh`, `auth.mfa.enable`,
  `users.profile.update`, …); `@AuditSkip()` exists for endpoints that must not be audited but is
  not used by any Phase 1 route.
- Rows are append-only (no update/delete API), queryable with `audit:read`, and retained 7 years
  (`database-schema-v1.md` §5). Actor deletion sets `actor_user_id` to `NULL` rather than removing
  history.
- Security-relevant events additionally written by the services themselves (outside the
  interceptor): `auth.login.mfa-pending`, `auth.account.locked`, `auth.refresh.reuse-detected`. Role,
  permission, API key and setting changes are covered by the interceptor on their controllers.

## 5. Data protection

| Data                     | Control                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Passwords                | Argon2id hash only.                                                                                                               |
| Refresh tokens, API keys | SHA-256 hash only; raw value shown once at creation.                                                                              |
| MFA secrets              | AES-256-GCM, per-user AAD, key outside the database.                                                                              |
| Secret settings          | AES-256-GCM; redacted in responses without `settings:read-secrets`.                                                               |
| Logs                     | Authorization, cookie, API key and `Set-Cookie` headers redacted; bodies not logged.                                              |
| Audit payloads           | Keys matching password/secret/token/key/otp/credential patterns replaced with `[REDACTED]`; bodies truncated at 8 000 characters. |
| Error reports            | Sentry `beforeSend` removes auth headers and cookies; PII scrubbing defaults on.                                                  |
| E-mail / phone           | `citext` e-mail unique per realm; phone unique; both only returned to the owner or admins with `users:read`.                      |
| Retention                | Policy in `database-schema-v1.md` §5 (audit 7 y, tokens 30 d after expiry, notifications 13 m with payload nulling at 90 d).      |
| Erasure                  | Soft delete in Phase 1; hard erasure with KYC/AML exceptions designed in Phase 2 (GDPR, Nigeria NDPA, Kenya DPA, Ghana DPA).      |

## 6. Secrets management

Summarised from `environment-management.md` §4: secrets live only in Fly secrets, Vercel
environment variables, GitHub Environments (with reviewers on `production`) and the Neon console;
`.env` files are git-ignored and `gitleaks` scans every push and the full history on schedule; the
API refuses to boot in production with placeholder values; rotation cadences are 90 days (JWT
access), 180 days (refresh secret, database, Redis, SMTP) and yearly (`ENCRYPTION_KEY`, deploy
tokens), with written procedures.

## 7. Supply chain and pipeline security

| Control                       | Where                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lockfile and pinned toolchain | `pnpm-lock.yaml` with `--frozen-lockfile`; Node 22 and pnpm 10 pinned (`.nvmrc`, `packageManager`); exact-ish versions per CLAUDE.md.                                                       |
| Static analysis               | CodeQL (JavaScript/TypeScript) on PRs, pushes and weekly (`security.yml`).                                                                                                                  |
| Dependency review             | `dependency-review-action` fails on high severity and denies GPL-3.0 / AGPL-3.0 / SSPL licences; `pnpm audit --prod --audit-level high` reported on every run.                              |
| Secret scanning               | `gitleaks` on every push and PR.                                                                                                                                                            |
| Dependency updates            | Dependabot weekly, grouped (NestJS, Prisma minor/patch only, Next/React, OpenTelemetry/Sentry, tooling), GitHub Actions and Docker base images included.                                    |
| Image scanning                | Trivy on the built API image: CRITICAL/HIGH reported as SARIF to code scanning; CRITICAL fails the job.                                                                                     |
| Provenance                    | `actions/attest-build-provenance` on the GHCR image; deploys reference the digest, never a mutable tag.                                                                                     |
| Infra linting                 | hadolint, shellcheck, actionlint, `docker compose config`, `docker build --check`, `terraform fmt` in `ci.yml`.                                                                             |
| Least-privilege workflows     | `permissions:` declared per workflow; `GITHUB_TOKEN` scoped; deploy tokens per environment; manual DB migrations require typing the environment name and pass through environment approval. |
| Review gates                  | Branch protection with `CI / ci-ok` required; CODEOWNERS routes `apps/api`, `packages/db`, `infra`, `.github`, `SECURITY.md` and every `.env.example` to platform owners.                   |

## 8. Availability and abuse resistance

- Two API machines minimum, rolling deploys gated on readiness, smoke test after deploy, digest
  rollback.
- Throttling (§2.2), request body limits (Express default 100 kB JSON), Prisma connection cap per
  instance, Neon pooler, `noeviction` Redis so queue state is never silently dropped.
- Health endpoints and `/metrics` are public but contain no PII; `/docs` is public in Phase 1
  (restrict to internal networks or admins before go-live if the API surface becomes sensitive).

## 9. Open items

| Item                                                                                                                  | Owner       | Target       |
| --------------------------------------------------------------------------------------------------------------------- | ----------- | ------------ |
| Per-request CSP nonces to drop `'unsafe-inline'` from `script-src`                                                    | Frontend    | Phase 2      |
| Key versioning for `ENCRYPTION_KEY` (`ENCRYPTION_KEYS=v1:…,v2:…`) and a re-encrypt task                               | Backend     | Phase 2      |
| E-mail verification flow at registration (accounts are created `ACTIVE`; `auth.registration.open` flag gates sign-up) | Backend     | Phase 2      |
| Retention job (`refresh_tokens`, `notifications`, `outbox`)                                                           | Backend     | Phase 2      |
| Sentry for the portals with source maps                                                                               | Frontend    | Phase 2      |
| ZAP baseline scan and k6 abuse scenarios in CI                                                                        | QA / DevOps | Phase 1 exit |
| Branch protection and CODEOWNERS team handles once the GitHub organisation exists                                     | DevOps      | Phase 1 exit |
| `/docs` exposure decision for production                                                                              | Architect   | Phase 1 exit |
