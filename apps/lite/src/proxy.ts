import { type NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE, verifySessionToken } from '@/server/auth/token';
import { canAccessPath, homePathForRole } from '@/server/rbac';

/**
 * Request proxy (Next.js 16 renamed `middleware` to `proxy`; it runs on the Node.js runtime).
 *
 * 1. Correlation id: accepts or generates `x-request-id`, forwards it to the app (audit rows
 *    record it) and echoes it on the response.
 * 2. First line of defence for /app, /admin and /partner: a missing or forged session token is
 *    redirected to /login and a valid token for the wrong role to that role's own area — without
 *    touching the database. The area layouts and every service call re-check against the live
 *    session, so a revoked session or suspended user is still refused.
 */

const PROTECTED_PREFIXES = ['/app', '/admin', '/partner'] as const;

const isProtected = (pathname: string): boolean =>
  PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const incoming = request.headers.get('x-request-id');
  const requestId =
    incoming && /^[A-Za-z0-9._-]{8,100}$/.test(incoming) ? incoming : crypto.randomUUID();

  if (isProtected(pathname)) {
    const payload = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
    if (!payload) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '';
      url.searchParams.set('next', `${pathname}${search}`);
      const response = NextResponse.redirect(url);
      response.headers.set('x-request-id', requestId);
      return response;
    }
    if (!canAccessPath(payload.role, pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = homePathForRole(payload.role);
      url.search = '';
      const response = NextResponse.redirect(url);
      response.headers.set('x-request-id', requestId);
      return response;
    }
  }

  const headers = new Headers(request.headers);
  headers.set('x-request-id', requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  // Everything except static assets.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|roadmap-full.html|.*\\.(?:png|svg|ico|webp)$).*)',
  ],
};
