import { NextResponse } from 'next/server';

import { API_VERSION } from './_lib/handler';
import { API_ENDPOINTS } from './_lib/reference';

export const runtime = 'nodejs';

/**
 * GET /api/v1 — index of the public API (no key needed): where the documentation is and which
 * endpoints exist. Everything else under /api/v1 requires `Authorization: Bearer <api key>`.
 */
export function GET(): NextResponse {
  return NextResponse.json(
    {
      name: process.env.NEXT_PUBLIC_APP_NAME ?? 'BI-Rem Lite',
      apiVersion: API_VERSION,
      documentation: '/partner/docs',
      openapi: '/api/v1/openapi.json',
      authentication: 'Authorization: Bearer <api key>',
      endpoints: API_ENDPOINTS.map((endpoint) => ({
        method: endpoint.method,
        path: endpoint.path,
        summary: endpoint.summary,
        scope: endpoint.scope,
      })),
    },
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}
