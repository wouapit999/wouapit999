// Runs before the Vercel build. Hosted Postgres integrations (Vercel Postgres, Neon, Supabase,
// Prisma Postgres) expose their connection strings under different names; map them to the two
// names Prisma expects so no manual variable setup is needed. Never prints secret values.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolveDatabaseUrls } from "./db-urls.mjs";

const { pooled, direct } = resolveDatabaseUrls(process.env);

if (!pooled) {
  console.error("prepare-env: no database URL found. Set DATABASE_URL, or attach a Postgres store in Vercel and connect it to this project.");
  process.exit(1);
}

const lines = [];
const current = existsSync(".env") ? readFileSync(".env", "utf8") : "";
if (!process.env.DATABASE_URL && !/^DATABASE_URL=/m.test(current)) lines.push(`DATABASE_URL="${pooled}"`);
if (!process.env.DIRECT_URL && !/^DIRECT_URL=/m.test(current)) lines.push(`DIRECT_URL="${direct}"`);
if (lines.length) {
  appendFileSync(".env", `\n# added by scripts/prepare-env.mjs at build time\n${lines.join("\n")}\n`);
  console.log(`prepare-env: wrote ${lines.map((l) => l.split("=")[0]).join(", ")} to .env`);
} else {
  console.log("prepare-env: DATABASE_URL and DIRECT_URL already set");
}
