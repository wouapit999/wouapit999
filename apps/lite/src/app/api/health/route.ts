import { NextResponse } from 'next/server';

import { db } from '@/server/db';

/**
 * Liveness + readiness: `200 { status: "ok" }` when the database answers, `503` otherwise.
 * Public and cheap (one `SELECT 1`); no internals are exposed.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const started = Date.now();
  const base = { service: 'bi-rem-lite', time: new Date().toISOString() };
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        status: 'ok',
        ...base,
        checks: { database: { status: 'up', latencyMs: Date.now() - started } },
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[health] database check failed', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { status: 'degraded', ...base, checks: { database: { status: 'down' } } },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
