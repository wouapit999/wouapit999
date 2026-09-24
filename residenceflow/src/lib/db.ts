import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Accept the variable names used by hosted Postgres integrations (Vercel Postgres, Neon, Supabase,
// Prisma Postgres) so a deployment works without renaming anything. Mirrors scripts/db-urls.mjs.
if (!process.env.DATABASE_URL || !/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
  const isPg = (v?: string) => !!v && /^postgres(ql)?:\/\//.test(v);
  const found = Object.entries(process.env).find(([k, v]) => /(DATABASE_URL|POSTGRES_URL|POSTGRES_PRISMA_URL)/i.test(k) && !/NON_POOLING|UNPOOLED|DIRECT/i.test(k) && isPg(v))
    ?? Object.entries(process.env).find(([k, v]) => /(DATABASE_URL|POSTGRES_URL)/i.test(k) && isPg(v));
  if (found) process.env.DATABASE_URL = found[1];
}
process.env.DIRECT_URL ||= process.env.DATABASE_URL;

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
