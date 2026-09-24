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

for (const cmd of ["prisma generate", "prisma migrate deploy", "next build"]) {
  console.log(`vercel-build: ${cmd}`);
  const r = spawnSync("npx", cmd.split(" "), { stdio: "inherit", env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
