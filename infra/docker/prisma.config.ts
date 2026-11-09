/**
 * Runtime Prisma config shipped inside the API image (see api.Dockerfile).
 *
 * It mirrors packages/db/prisma.config.ts but deliberately imports nothing: the production
 * image contains the globally installed Prisma CLI, not the workspace's `prisma` package, so
 * `import { defineConfig } from 'prisma/config'` would not resolve. `defineConfig` is an
 * identity helper, so a plain object with the same shape is equivalent.
 *
 * Paths are resolved relative to this file: the Dockerfile copies
 * packages/db/prisma/schema.prisma and packages/db/prisma/migrations next to it.
 *
 * DIRECT_URL (Neon direct endpoint) is preferred for migrations; the pooled DATABASE_URL is
 * only a fallback because PgBouncer in transaction mode does not support advisory locks.
 */
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DIRECT_URL or DATABASE_URL must be set to run Prisma migrations');
}

export default {
  schema: 'schema.prisma',
  migrations: {
    path: 'migrations',
  },
  datasource: {
    url: databaseUrl,
  },
};
