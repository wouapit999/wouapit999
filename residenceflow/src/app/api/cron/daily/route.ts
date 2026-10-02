import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/auth/crypto";
import { dailyJob, runOnce } from "@/services/jobs";
import { todayUtc } from "@/services/billing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Invoked by Vercel Cron (Authorization: Bearer $CRON_SECRET). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  const key = `daily:${todayUtc().toISOString().slice(0, 10)}`;
  const started = Date.now();
  try {
    const r = await runOnce(key, force, () => dailyJob());
    console.info(JSON.stringify({ level: "info", msg: "cron_daily", key, skipped: r.skipped, ms: Date.now() - started }));
    return NextResponse.json({ key, ...r });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "cron_daily_failed", key, error: (e as Error).message }));
    return NextResponse.json({ key, error: "job_failed" }, { status: 500 });
  }
}
