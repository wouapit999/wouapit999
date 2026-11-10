import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration for BI-Rem Lite.
 *
 * - The datasource URL lives here, not in schema.prisma (a Prisma 7 requirement).
 * - Migrations and introspection prefer `DATABASE_URL_UNPOOLED` (the Neon direct endpoint the
 *   Vercel–Neon integration provides) and fall back to `DATABASE_URL`.
 * - `prisma generate` never connects; an unresolvable placeholder keeps it working offline while
 *   any command that really connects fails fast with an obvious host name.
 */
const OFFLINE_PLACEHOLDER_URL =
  'postgresql://missing:missing@missing-database-url.invalid:5432/birem_lite';

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? OFFLINE_PLACEHOLDER_URL;

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
