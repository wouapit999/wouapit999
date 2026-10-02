/**
 * Finds usable PostgreSQL connection strings among environment variables, whatever the hosting
 * integration named them. Only plain postgres:// / postgresql:// URLs qualify (Prisma Accelerate
 * "prisma+postgres://" URLs need a different client and are skipped).
 *   pooled: for the application (DATABASE_URL)
 *   direct: for migrations (DIRECT_URL) — a non-pooled URL when one exists, else the pooled one
 */
export function resolveDatabaseUrls(env) {
  const isPg = (v) => typeof v === "string" && /^postgres(ql)?:\/\//.test(v);
  const explicit = { pooled: isPg(env.DATABASE_URL) ? env.DATABASE_URL : undefined, direct: isPg(env.DIRECT_URL) ? env.DIRECT_URL : undefined };
  const candidates = Object.entries(env).filter(([k, v]) => /(DATABASE_URL|POSTGRES_URL|POSTGRES_PRISMA_URL)/i.test(k) && isPg(v));
  const nonPooled = candidates.filter(([k]) => /NON_POOLING|UNPOOLED|DIRECT/i.test(k));
  const pooledOnly = candidates.filter(([k]) => !/NON_POOLING|UNPOOLED|DIRECT/i.test(k));
  const pooled = explicit.pooled ?? pooledOnly[0]?.[1] ?? nonPooled[0]?.[1];
  const direct = explicit.direct ?? nonPooled[0]?.[1] ?? pooled;
  return { pooled, direct };
}
