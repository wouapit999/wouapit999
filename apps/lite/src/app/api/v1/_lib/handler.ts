import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AppError } from '@/server/errors';
import { serialize } from '@/server/money';
import {
  type ApiKeyAuthentication,
  type ApiKeyScope,
  assertApiScope,
  authenticateApiKey,
} from '@/server/partners';

import { PROBLEM_CONTENT_TYPE, toProblem } from './problem';

/**
 * Plumbing shared by every `/api/v1/**` route handler:
 *
 * 1. authenticates `Authorization: Bearer brl_…` (sha256 lookup + constant-time comparison,
 *    revoked keys and inactive partners refused, per-key rate limit) — nothing runs before it;
 * 2. checks the scope the route needs;
 * 3. hands the handler an `ActionContext` whose actor is the API key, so every service call is
 *    scoped to that partner and audited under the key;
 * 4. turns any thrown error into an RFC 9457 problem document.
 */

export const API_VERSION = 'v1';
const MAX_BODY_BYTES = 32 * 1024;

export interface V1Request<Params> {
  readonly request: Request;
  readonly url: URL;
  readonly auth: ApiKeyAuthentication;
  readonly params: Params;
  readonly requestId: string;
}

const REQUEST_ID = /^[A-Za-z0-9._-]{8,100}$/;

/** The correlation id set by the proxy (or supplied by the caller), else a new one. */
export function requestIdOf(request: Request): string {
  const incoming = request.headers.get('x-request-id');
  return incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}

const clientIp = (request: Request): string | null => {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded && forwarded.length <= 64 ? forwarded : null;
};

const baseHeaders = (requestId: string): Record<string, string> => ({
  'cache-control': 'no-store',
  'x-request-id': requestId,
  'x-content-type-options': 'nosniff',
});

export function problemResponse(error: unknown, request: Request, requestId: string): Response {
  if (!(error instanceof AppError) && !(error instanceof z.ZodError)) {
    // Never log request bodies or credentials — only the message of the unexpected error.
    console.error(
      `[api/v1] unexpected error (request ${requestId})`,
      error instanceof Error ? error.message : 'non-error thrown',
    );
  }
  const problem = toProblem(error, { instance: new URL(request.url).pathname, requestId });
  return new Response(JSON.stringify(problem.body), {
    status: problem.status,
    headers: {
      ...baseHeaders(requestId),
      ...problem.headers,
      'content-type': PROBLEM_CONTENT_TYPE,
    },
  });
}

/**
 * Builds a route handler. `scope` is the API-key scope the route requires (omit for routes any
 * valid key may call).
 */
export function v1Route<Params extends Record<string, string> = Record<string, never>>(
  options: { scope?: ApiKeyScope },
  handler: (input: V1Request<Params>) => Promise<Response>,
): (request: Request, context: { params: Promise<Params> }) => Promise<Response> {
  return async (request, context) => {
    const requestId = requestIdOf(request);
    try {
      const auth = await authenticateApiKey(request.headers.get('authorization'), {
        ip: clientIp(request),
        userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
        requestId,
      });
      if (options.scope) assertApiScope(auth, options.scope);
      const response = await handler({
        request,
        url: new URL(request.url),
        auth,
        params: await context.params,
        requestId,
      });
      for (const [name, value] of Object.entries(baseHeaders(requestId))) {
        if (!response.headers.has(name)) response.headers.set(name, value);
      }
      return response;
    } catch (error) {
      return problemResponse(error, request, requestId);
    }
  };
}

/** `{ data }` — bigint, Date and Decimal values are serialised as strings. */
export function v1Json(
  data: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): NextResponse {
  return NextResponse.json(
    { data: serialize(data) },
    { status: init.status ?? 200, headers: init.headers },
  );
}

/** `{ data: [...], pagination }` for paged collections. */
export function v1List(
  items: readonly unknown[],
  pagination: { page: number; pageSize: number; total: number },
): NextResponse {
  return NextResponse.json({
    data: serialize(items),
    pagination: {
      ...pagination,
      pages: Math.max(Math.ceil(pagination.total / pagination.pageSize), 1),
    },
  });
}

/** Parses a JSON object body (≤ 32 KiB). Throws VALIDATION for anything else. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && BigInt(declared) > BigInt(MAX_BODY_BYTES)) {
    throw new AppError('VALIDATION', 'Request body is too large');
  }
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new AppError('VALIDATION', 'Request body is too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError('VALIDATION', 'Request body must be valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError('VALIDATION', 'Request body must be a JSON object');
  }
  return parsed;
}

/** Query string → plain object (first value of each parameter; empty values dropped). */
export function queryObject(url: URL): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (value !== '' && !(key in result)) result[key] = value;
  }
  return result;
}
