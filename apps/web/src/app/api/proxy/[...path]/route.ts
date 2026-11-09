import { type NextRequest, NextResponse } from 'next/server';

import { HTTP_HEADERS } from '@bi-rem/shared/constants';

import { getApiBaseUrl } from '@/env';
import { ApiClient, ApiError } from '@/lib/api';
import { COOKIE_NAMES } from '@/lib/server/cookies';
import { problemResponse, rejectCrossSiteRequest, withErrorHandling } from '@/lib/server/handlers';
import { resolveProxyPath } from '@/lib/server/proxy-path';
import { resolveRequestLocale } from '@/i18n/server';

/**
 * Same-origin data proxy. The browser calls `/api/proxy/v1/...`; this handler forwards the
 * request to the API with the access token from the httpOnly cookie. It does not refresh:
 * on a 401 the browser client calls `/api/auth/refresh` and retries, so the refresh token is
 * only ever sent to `/api/auth/*`.
 */

/** Request headers forwarded upstream; everything else (cookies, host…) is dropped. */
const FORWARDED_REQUEST_HEADERS = ['accept', 'if-none-match', HTTP_HEADERS.idempotencyKey];

/** Response headers passed back to the browser. */
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'etag', 'retry-after', HTTP_HEADERS.requestId];

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type ProxyMethod = (typeof METHODS)[number];

function isProxyMethod(value: string): value is ProxyMethod {
  return (METHODS as readonly string[]).includes(value);
}

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function forward(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  const resolved = resolveProxyPath(path);
  if (!resolved.ok) {
    return problemResponse({
      type: 'about:blank',
      title: 'Not found',
      status: 404,
      code: 'NOT_FOUND',
    });
  }

  const method = request.method.toUpperCase();
  if (!isProxyMethod(method)) {
    return problemResponse({ type: 'about:blank', title: 'Method not allowed', status: 405 });
  }

  const rejected = rejectCrossSiteRequest(request);
  if (rejected) return rejected;

  const accessToken = request.cookies.get(COOKIE_NAMES.access)?.value;
  if (!accessToken) {
    return problemResponse({
      type: 'about:blank',
      title: 'Not authenticated',
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  }

  const headers: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  const locale = resolveRequestLocale(request.cookies, request.headers);
  const incomingRequestId = request.headers.get(HTTP_HEADERS.requestId);
  const client = new ApiClient({
    baseUrl: getApiBaseUrl(),
    auth: { getAccessToken: () => accessToken },
    getLocale: () => locale,
    ...(incomingRequestId ? { requestId: () => incomingRequestId } : {}),
  });

  const rawBody = method !== 'GET' && request.body !== null ? await request.text() : '';
  let body: unknown;
  if (rawBody.length > 0) {
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      return problemResponse({
        type: 'about:blank',
        title: 'Malformed JSON body',
        status: 400,
        code: 'VALIDATION_FAILED',
      });
    }
  }

  let upstream: Response;
  try {
    upstream = await client.send(`${resolved.path}${request.nextUrl.search}`, {
      method,
      ...(body !== undefined ? { body } : {}),
      headers,
      skipAuthRetry: true,
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
      return problemResponse({
        type: 'about:blank',
        title: 'Upstream unavailable',
        status: 502,
        code: 'SERVICE_UNAVAILABLE',
      });
    }
    throw error;
  }

  const responseHeaders = new Headers({ 'cache-control': 'no-store' });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new NextResponse(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

const handler = withErrorHandling(forward);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
