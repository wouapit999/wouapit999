# Deploying the API to Fly.io

The API is a single Docker image (`infra/docker/api.Dockerfile`) deployed to two Fly apps:

| Environment | Fly app              | Trigger              | Protection                                           |
| ----------- | -------------------- | -------------------- | ---------------------------------------------------- |
| staging     | `bi-rem-api-staging` | every push to `main` | GitHub Environment `staging` (no reviewers)          |
| production  | `bi-rem-api`         | tag `v*`             | GitHub Environment `production` (required reviewers) |

`.github/workflows/deploy-api.yml` builds the image once, pushes it to GHCR (with SBOM and
provenance attestations), mirrors the digest into the Fly registry and runs
`fly deploy --image ...` with `infra/fly/api.fly.toml`. Migrations run in the
`release_command` (`prisma migrate deploy`) before the new machines receive traffic.

## One-time setup

```bash
fly auth login
fly apps create bi-rem-api-staging --org <org>
fly apps create bi-rem-api --org <org>

# Scale baseline: 2 machines in the primary region (min_machines_running = 2 in fly.toml)
fly scale count 2 --app bi-rem-api-staging --region cdg --yes
fly scale count 2 --app bi-rem-api --region cdg --yes

# Secrets — one block per app. Generate with: openssl rand -base64 48 / -base64 32
fly secrets set --app bi-rem-api-staging \
  DATABASE_URL='postgresql://...-pooler.eu-central-1.aws.neon.tech/birem?sslmode=require' \
  DIRECT_URL='postgresql://...eu-central-1.aws.neon.tech/birem?sslmode=require' \
  REDIS_URL='rediss://...' \
  JWT_ACCESS_SECRET='...' JWT_REFRESH_SECRET='...' ENCRYPTION_KEY='...' \
  SMTP_HOST='smtp.example.com' SMTP_PORT='587' SMTP_USER='...' SMTP_PASS='...' \
  SMTP_FROM='BI-Rem <no-reply@bi-rem.africa>' \
  CORS_ORIGINS='https://app.staging.bi-rem.africa,https://admin.staging.bi-rem.africa' \
  API_BASE_URL='https://api.staging.bi-rem.africa' \
  CUSTOMER_PORTAL_URL='https://app.staging.bi-rem.africa' \
  ADMIN_PORTAL_URL='https://admin.staging.bi-rem.africa' \
  SENTRY_DSN='...'

# Deploy token for GitHub Actions (store as FLY_API_TOKEN in both GitHub Environments)
fly tokens create deploy --app bi-rem-api-staging --expiry 8760h
fly tokens create deploy --app bi-rem-api --expiry 8760h

# Custom domains
fly certs add api.staging.bi-rem.africa --app bi-rem-api-staging
fly certs add api.bi-rem.africa --app bi-rem-api
```

Redis: either Upstash Redis through `fly redis create` (returns a `rediss://` URL) or a
managed provider of your choice. The API degrades gracefully without `REDIS_URL` (in-process
queue and caches) but production must set it so multiple machines share rate-limit state.

## Manual deploy / rollback

```bash
infra/scripts/deploy-api.sh staging                      # builds locally, deploys, smoke tests
infra/scripts/deploy-api.sh production ghcr.io/wouapit999/bi-rem-api@sha256:<digest>

fly releases --app bi-rem-api                             # list releases with image refs
fly deploy --app bi-rem-api --config infra/fly/api.fly.toml \
  --image registry.fly.io/bi-rem-api:<previous-tag>       # roll back to a previous image
```

Rolling back the code does not roll back the schema. Migrations are written to be
backward-compatible for one release (expand/contract), so the previous image keeps running
on the new schema. For a destructive migration use Neon point-in-time restore
(`infra/scripts/db-restore.sh`).

## Autoscaling

`min_machines_running = 2` with `auto_stop_machines = "off"` keeps two always-on machines
in `cdg`; Fly's proxy starts more machines (up to the count created with `fly scale count`)
when the `soft_limit` of 200 concurrent requests per machine is exceeded. For metrics-based
autoscaling attach `fly-autoscaler` to the `/metrics` endpoint.

## Choosing `jnb` instead of `cdg`

```bash
sed -i 's/^primary_region = "cdg"/primary_region = "jnb"/' infra/fly/api.fly.toml
fly scale count 2 --region jnb --app bi-rem-api
```

Keep the database close to the API: Neon has no African region today, so a `jnb` primary
pairs best with `aws-eu-central-1` (about 160 ms RTT) and the pooled connection string; for
`cdg` the same Neon region is about 10 ms away. Re-run the smoke test after switching.
