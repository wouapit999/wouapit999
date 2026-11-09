import { type NextRequest, NextResponse } from 'next/server';

import { refreshTokenSchema } from '@bi-rem/shared/schemas';

import { ApiError } from '@/lib/api';
import { authSessionSchema } from '@/lib/auth-schemas';
import { API, PAGES, safeNextPath } from '@/lib/routes';
import { createPublicApi } from '@/lib/server/api';
import { COOKIE_NAMES, clearSessionCookies, setSessionCookies } from '@/lib/server/cookies';
import { problemResponse, withErrorHandling } from '@/lib/server/handlers';

type RefreshOutcome =
  | { ok: true; tokens: Parameters<typeof setSessionCookies>[1] }
  | { ok: false; reason: 'missing' | 'rejected' };

async function rotate(request: NextRequest): Promise<RefreshOutcome> {
  const refreshToken = request.cookies.get(COOKIE_NAMES.refresh)?.value;
  const parsed = refreshTokenSchema.safeParse({ refreshToken });
  if (!parsed.success) return { ok: false, reason: 'missing' };

  const api = await createPublicApi();
  try {
    const tokens = await api.post(API.auth.refresh, parsed.data, {
      schema: authSessionSchema,
      skipAuthRetry: true,
    });
    return { ok: true, tokens };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return { ok: false, reason: 'rejected' };
    }
    throw error;
  }
}

/** XHR refresh used by the browser API client: rotates cookies, answers `{ ok: true }` or 401. */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const outcome = await rotate(request);
  if (!outcome.ok) {
    const response = problemResponse({
      type: 'about:blank',
      title: 'Session expired',
      status: 401,
      code: outcome.reason === 'missing' ? 'UNAUTHENTICATED' : 'TOKEN_REVOKED',
    });
    clearSessionCookies(response);
    return response;
  }
  const response = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  setSessionCookies(response, outcome.tokens);
  return response;
});

/**
 * Navigation refresh used by `proxy.ts` and the dashboard layout: rotates cookies and sends
 * the browser back to `?next=`, or to the login page when the session cannot be renewed.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const next = safeNextPath(request.nextUrl.searchParams.get('next'), PAGES.dashboard);
  const outcome = await rotate(request);

  if (!outcome.ok) {
    const response = relativeRedirect(`${PAGES.login}?next=${encodeURIComponent(next)}`);
    clearSessionCookies(response);
    return response;
  }

  const response = relativeRedirect(next);
  setSessionCookies(response, outcome.tokens);
  return response;
});

/**
 * Relative `Location` keeps the redirect on whatever host the browser used (behind proxies the
 * server-side origin is not reliable). `next` has already passed `safeNextPath`.
 */
function relativeRedirect(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { location, 'cache-control': 'no-store' },
  });
}
