# Secret rotation runbook

Scope: every secret the API, portals and pipelines depend on. Rotate **on schedule** (table
below), **on departure** of anyone who had access, and **immediately** on suspected exposure
(gitleaks finding, leaked log, vendor breach). Record each rotation in the security log
(date, secret, operator, reason).

| Secret                                             | Where it lives                                                    | Schedule                | Downtime-free procedure                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`                                | Fly secrets / Secrets Manager                                     | 90 days                 | Dual-key not supported yet: rotate during low traffic. Access tokens live 15 min, so users re-authenticate transparently via refresh tokens.                                                                                                                                                                                                               |
| `JWT_REFRESH_SECRET`                               | Fly secrets / Secrets Manager                                     | 180 days                | Refresh tokens are opaque and hashed in the DB; the secret only signs nothing today — rotate together with access secret. All sessions remain valid.                                                                                                                                                                                                       |
| `ENCRYPTION_KEY`                                   | Fly secrets / Secrets Manager                                     | 365 days or on exposure | **Requires re-encryption** of `settings.value` (secret settings) and `users.mfa_secret`. Run the re-encrypt task (`pnpm --filter @bi-rem/api exec node dist/tasks/reencrypt.js --from $OLD --to $NEW` once Phase 2 ships it) before switching the env var. Until then: export old key, re-encrypt with a one-off script, deploy new key, verify MFA login. |
| `DATABASE_URL` / `DIRECT_URL` (Neon role password) | Neon console, Fly secrets, GitHub Environments (`db-migrate.yml`) | 180 days                | Neon: create a second role (`birem_app_v2`), grant same privileges, update secrets, deploy, then drop the old role after 24 h.                                                                                                                                                                                                                             |
| `REDIS_URL`                                        | Upstash/ElastiCache, Fly secrets                                  | 180 days                | Upstash supports two passwords (primary/secondary): add secondary, roll secrets, remove primary.                                                                                                                                                                                                                                                           |
| SMTP credentials                                   | Provider, Fly secrets                                             | 180 days                | Create new API key at the provider, update `SMTP_PASS`, deploy, revoke old key.                                                                                                                                                                                                                                                                            |
| `SENTRY_DSN`                                       | Sentry                                                            | on exposure             | DSNs are low sensitivity; rotate by creating a new client key and disabling the old one.                                                                                                                                                                                                                                                                   |
| `FLY_API_TOKEN`                                    | GitHub Environments `staging`, `production`                       | 365 days (token expiry) | `fly tokens create deploy --app <app> --expiry 8760h`, update env secret, `fly tokens revoke <old-id>`.                                                                                                                                                                                                                                                    |
| `VERCEL_TOKEN`                                     | GitHub Environments `preview`, `production`                       | 365 days                | Vercel → Settings → Tokens; create team-scoped token, update, delete old.                                                                                                                                                                                                                                                                                  |
| `GHCR` push                                        | `GITHUB_TOKEN` (ephemeral)                                        | n/a                     | Nothing to rotate; permissions are declared per workflow.                                                                                                                                                                                                                                                                                                  |
| `GITLEAKS_LICENSE` (orgs only)                     | GitHub secret                                                     | yearly                  | Gitleaks account.                                                                                                                                                                                                                                                                                                                                          |
| Seed admin password (`SEED_ADMIN_PASSWORD`)        | one-time                                                          | at first login          | Force change on first login; never reuse the seed value in production.                                                                                                                                                                                                                                                                                     |
| Local dev secrets (`.env`)                         | developer machines                                                | on demand               | `openssl rand -base64 48`; local values must never match staging/production.                                                                                                                                                                                                                                                                               |

## Generating values

```bash
openssl rand -base64 48        # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (>= 32 chars)
openssl rand -base64 32        # ENCRYPTION_KEY (exactly 32 bytes, base64)
```

## Rolling a Fly secret without a visible outage

```bash
fly secrets set --app bi-rem-api --stage JWT_ACCESS_SECRET="$(openssl rand -base64 48)"
fly deploy --app bi-rem-api --config infra/fly/api.fly.toml --image <current image>  # rolling restart
fly secrets list --app bi-rem-api                                                     # digests only
```

`--stage` avoids an immediate restart so several secrets can be rotated in one rolling
deploy. For ECS: `aws secretsmanager put-secret-value` then
`aws ecs update-service --force-new-deployment`.

## GitHub Actions secrets

Secrets are scoped to **Environments** (`staging`, `production`, `preview`) with required
reviewers on `production`. Rotation = update the environment secret; no workflow changes.
Repository-level secrets are limited to `NEON_API_KEY`/`NEON_PROJECT_ID` (optional) and
`GITLEAKS_LICENSE`.

## After an exposure

1. Rotate the secret (above) and invalidate derived credentials (refresh tokens:
   `UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL`).
2. Purge the secret from git history if committed (`git filter-repo`), force-push, and ask
   GitHub support to clear cached views; rotate anyway — history rewriting is not revocation.
3. Review `audit_logs` for the exposure window; file a SECURITY.md incident entry.
