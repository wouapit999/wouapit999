// Vercel build entry point: resolves the database URLs from whatever the hosting integration
// provides, then runs generate → migrate → build with DATABASE_URL / DIRECT_URL set explicitly
// for each step (an empty variable pre-set by an integration would otherwise win over .env).
import { spawnSync } from "node:child_process";
import { resolveDatabaseUrls } from "./db-urls.mjs";

const { pooled, direct } = resolveDatabaseUrls(process.env);
if (!pooled) {
  console.error("vercel-build: no database URL found. Set DATABASE_URL, or attach a Postgres store in Vercel and connect it to this project.");
  process.exit(1);
}
const env = { ...process.env, DATABASE_URL: pooled, DIRECT_URL: direct };
const from = (v) => Object.entries(process.env).find(([, val]) => val === v)?.[0] ?? "resolved";
console.log(`vercel-build: DATABASE_URL from ${from(pooled)}, DIRECT_URL from ${from(direct)}`);

function run(cmd, opts = {}) {
  console.log(`vercel-build: ${cmd}`);
  return spawnSync("npx", cmd.split(" "), { stdio: opts.capture ? "pipe" : "inherit", env, encoding: "utf8", shell: process.platform === "win32" });
}

/**
 * A migration that failed half-way (P3009) blocks every later deploy. On a database that holds
 * no business data yet this is safe to repair by recreating the schema; with data present we stop
 * and leave the decision to an operator (see docs/RUNBOOK.md, "Failed migration").
 */
async function repairFailedMigration() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: direct } } });
  try {
    const failed = await db.$queryRawUnsafe(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
    );
    if (!Array.isArray(failed) || failed.length === 0) return false;
    const orgs = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "Organization"`).catch(() => [{ n: 0 }]);
    const n = Array.isArray(orgs) && orgs[0] ? Number(orgs[0].n) : 0;
    console.log(`vercel-build: failed migration(s) detected: ${failed.map((f) => f.migration_name).join(", ")}; organizations in database: ${n}`);
    if (n > 0) {
      console.error("vercel-build: the database contains data, refusing to reset. Resolve manually: npx prisma migrate resolve --rolled-back <name> after checking the schema.");
      return false;
    }
    console.log("vercel-build: empty database with a failed migration → recreating the schema");
    try {
      await db.$executeRawUnsafe(`DROP SCHEMA public CASCADE`);
      await db.$executeRawUnsafe(`CREATE SCHEMA public`);
      return true;
    } catch (e) {
      console.warn(`vercel-build: could not drop the schema directly (${e.message?.split("\n")[0]}); trying prisma migrate reset`);
    }
  } finally {
    await db.$disconnect();
  }
  return run("prisma migrate reset --force --skip-seed --skip-generate").status === 0;
}

if (run("prisma generate").status !== 0) process.exit(1);
const migrate = run("prisma migrate deploy", { capture: true });
process.stdout.write(migrate.stdout ?? "");
process.stderr.write(migrate.stderr ?? "");
if (migrate.status !== 0) {
  const p3009 = /P3009|failed migrations/.test(`${migrate.stdout}${migrate.stderr}`);
  if (!p3009 || !(await repairFailedMigration())) process.exit(migrate.status ?? 1);
  if (run("prisma migrate deploy").status !== 0) process.exit(1);
}
if (run("next build").status !== 0) process.exit(1);
