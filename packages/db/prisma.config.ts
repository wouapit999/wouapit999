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
 * - When neither variable is set the datasource block is omitted so that commands which
 *   never touch a database (validate, format, generate, migrate diff --from-empty) still
 *   run, while migrate/db commands fail fast with Prisma's own "datasource url missing" error.
 */
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
