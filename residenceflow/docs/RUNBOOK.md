# Operations runbook

## Environments & variables

See `.env.example`. Required in production: `DATABASE_URL`, `DIRECT_URL`, `CRON_SECRET`, `APP_BASE_URL` (or rely on Vercel's `VERCEL_PROJECT_PRODUCTION_URL`). Optional: SMTP_*, PAYMENT_*, STORAGE_*. Never commit populated env files.

## Deploy to Vercel

1. Import the GitHub repository in Vercel. Set **Root Directory = `residenceflow`**.
2. Add a PostgreSQL database (Vercel Marketplace → Neon, or any Postgres). Set `DATABASE_URL` (pooled) and `DIRECT_URL` (direct/non-pooled).
3. Set `CRON_SECRET` (random) and optionally SMTP variables.
4. Deploy. The build runs `npm run vercel-build` = `prisma generate && prisma migrate deploy && next build`.
5. Open `https://<app>/setup` once to create the organization and first administrator (only works while the database has no organization).
6. The daily job is scheduled by `vercel.json` (`/api/cron/daily`, 05:00 UTC = 06:00 Douala).

Demo deployment (never with real data): run `SEED_DEMO=true SEED_DEMO_PASSWORD='<strong>' DATABASE_URL=… npm run db:seed` from a workstation and set `NEXT_PUBLIC_DEMO_MODE=true`.

## Deploy with Docker

```bash
docker build -t residenceflow .
docker run -p 3000:3000 --env-file .env residenceflow   # runs migrations then starts
```

## Rollback

- **Code**: Vercel → Deployments → promote the previous deployment (instant). Docker: redeploy the previous image tag.
- **Schema**: migrations are forward-only. Write additive migrations (add columns nullable, backfill, then enforce) so the previous code version keeps working; to undo, ship a new migration. Restore from backup only for data loss.

## Backups

- Managed Postgres (Neon/Vercel/Supabase): enable point-in-time restore (PITR) and daily snapshots, retention ≥ 30 days.
- Self-managed: nightly logical backup
  ```bash
  pg_dump --format=custom --no-owner "$DIRECT_URL" > residenceflow-$(date +%F).dump
  ```
  Encrypt and copy off-site; keep 30 daily + 12 monthly.
- Documents live in the database (bytea) and are included in the dump.

## Restore procedure (test quarterly)

```bash
createdb residenceflow_restore
pg_restore --no-owner --dbname "postgresql://…/residenceflow_restore" residenceflow-YYYY-MM-DD.dump
DATABASE_URL=postgresql://…/residenceflow_restore npx prisma migrate status   # must report "up to date"
```
Verify: log in on a staging deployment pointed at the restored DB, compare invoice/payment counts and a tenant balance with production, then switch `DATABASE_URL` if performing a real recovery. Record the drill date and duration.

## Monitoring

- `GET /api/health` → 200 when the DB answers (use for uptime checks).
- `Administration → System status` shows DB latency, recent `JobRun` results, failed notifications.
- Logs are single-line JSON (`level`, `msg`, correlation ID). Alert on `cron_daily_failed`, `webhook_failed`, `action_failed` rate, and `auth.login` FAILURE spikes in the audit log.

## Re-running the daily job

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://<app>/api/cron/daily?force=1"
```
Safe: every step is idempotent.
