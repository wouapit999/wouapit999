import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration for @bi-rem/db.
 *
 * - The datasource URL lives here, not in schema.prisma (a Prisma 7 requirement).
 * - `dotenv/config` loads `packages/db/.env` (or the cwd `.env`) when present; in CI and
 *   production the variables are injected by the runtime.
 * - `DIRECT_URL` (Neon direct, non-pooled endpoint) is preferred for migrate/introspection
 *   commands when set; otherwise `DATABASE_URL` is used. The pooled `DATABASE_POOL_URL`
 *   is only ever used by the API at runtime, never by the CLI.
 * - The schema engine needs a datasource URL even for commands that never connect
 *   (`migrate diff --from-empty`, `validate`, `generate`). When neither variable is set we
 *   fall back to a deliberately unresolvable host so offline commands work, while any
 *   command that really connects fails fast with an obvious "missing-database-url" error.
 */
const OFFLINE_PLACEHOLDER_URL =
  'postgresql://missing:missing@missing-database-url.invalid:5432/birem';

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? OFFLINE_PLACEHOLDER_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
