/**
 * Prisma config used only by the CI migration-drift check (.github/workflows/ci.yml).
 *
 * Prisma 7 removed `--shadow-database-url` from `prisma migrate diff`; diffing a migrations
 * directory now requires `datasource.shadowDatabaseUrl` in the config, and it must differ
 * from `datasource.url`. The workspace config (packages/db/prisma.config.ts) is kept free of
 * CI concerns, so CI points the CLI at this file with `--config`. It imports nothing (see
 * infra/docker/prisma.config.ts for why) and resolves paths relative to this file.
 *
 * Usage (from packages/db):
 *   DATABASE_URL=postgresql://.../birem SHADOW_DATABASE_URL=postgresql://.../birem_shadow \
 *   pnpm exec prisma migrate diff --config ../../infra/ci/prisma.config.ts \
 *     --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
 */
const OFFLINE_PLACEHOLDER_URL =
  'postgresql://missing:missing@missing-database-url.invalid:5432/birem';

const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;
if (!shadowDatabaseUrl) {
  throw new Error('SHADOW_DATABASE_URL must be set for the migration drift check');
}

export default {
  schema: '../../packages/db/prisma/schema.prisma',
  migrations: {
    path: '../../packages/db/prisma/migrations',
  },
  datasource: {
    // `--from-migrations --to-schema` never connects to the main datasource, but the config
    // layer requires a URL distinct from the shadow database.
    url: process.env.DATABASE_URL ?? OFFLINE_PLACEHOLDER_URL,
    shadowDatabaseUrl,
  },
};
