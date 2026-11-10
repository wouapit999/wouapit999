import { NextResponse } from 'next/server';

import { buildOpenApiDocument } from '../_lib/openapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/openapi.json — machine-readable description of the public API (no key needed). */
export function GET(request: Request): NextResponse {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'https';
  const safeHost = /^[A-Za-z0-9.:[\]-]{1,255}$/.test(host) ? host : url.host;
  const scheme = protocol === 'http' ? 'http' : 'https';
  return NextResponse.json(
    buildOpenApiDocument({
      serverUrl: `${scheme}://${safeHost}`,
      appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'BI-Rem Lite',
    }),
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}
