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

/** Runs SQL through the Prisma CLI (no runtime client needed during the build). */
function sql(statement) {
  const r = spawnSync("npx", ["prisma", "db", "execute", "--url", direct, "--stdin"], { input: statement, encoding: "utf8", env, shell: process.platform === "win32" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * A migration that failed half-way (P3009) blocks every later deploy. On a database that holds
 * no business data yet this is safe to repair by recreating the schema; with data present we stop
 * and leave the decision to an operator (see docs/RUNBOOK.md, "Failed migration").
 */
function repairFailedMigration() {
  console.log("vercel-build: checking whether the database holds data before repairing the failed migration");
  // Raises HAS_DATA when organizations exist; an error about a missing table means the schema is incomplete → empty.
  const probe = sql(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Organization") THEN RAISE EXCEPTION 'HAS_DATA'; END IF; END $$;`);
  if (/HAS_DATA/.test(probe.out)) {
    console.error("vercel-build: the database contains organizations, refusing to reset. Resolve manually: npx prisma migrate resolve --rolled-back <name> after checking the schema.");
    return false;
  }
  if (!probe.ok && !/does not exist/i.test(probe.out)) {
    console.error(`vercel-build: could not inspect the database:\n${probe.out}`);
    return false;
  }
  console.log("vercel-build: no organizations found → recreating the schema");
  const drop = sql(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  if (!drop.ok) {
    console.warn(`vercel-build: DROP SCHEMA failed (${drop.out.trim().split("\n").pop()}); trying prisma migrate reset`);
    return run("prisma migrate reset --force --skip-seed --skip-generate").status === 0;
  }
  return true;
}

if (run("prisma generate").status !== 0) process.exit(1);
const migrate = run("prisma migrate deploy", { capture: true });
process.stdout.write(migrate.stdout ?? "");
process.stderr.write(migrate.stderr ?? "");
if (migrate.status !== 0) {
  const p3009 = /P3009|failed migrations/.test(`${migrate.stdout}${migrate.stderr}`);
  console.log(`vercel-build: migrate deploy failed (${p3009 ? "P3009: a previous migration failed half-way" : "see above"})`);
  let repaired = false;
  if (p3009) {
    try {
      repaired = repairFailedMigration();
    } catch (e) {
      console.error(`vercel-build: repair threw: ${e?.stack ?? e}`);
    }
  }
  if (!repaired) process.exit(migrate.status ?? 1);
  if (run("prisma migrate deploy").status !== 0) process.exit(1);
}
if (run("next build").status !== 0) process.exit(1);
