import { type NextProxy, NextResponse } from 'next/server';

import { BFF, PAGES, isAuthPage, isProtectedPath } from '@/lib/routes';

const ACCESS_COOKIE = 'birem_access';
const PATHNAME_HEADER = 'x-birem-pathname';

/**
 * Edge guard for the portal (Next.js 16 renamed `middleware` to `proxy`). It only inspects
 * cookie presence — token validity is checked by the dashboard layout against `/auth/me`.
 */
export const proxy: NextProxy = (request) => {
  const { pathname, search } = request.nextUrl;
  const hasAccess = request.cookies.has(ACCESS_COOKIE);

  if (isProtectedPath(pathname) && !hasAccess) {
    // The refresh handler sees the path-scoped refresh cookie and either renews the session or
    // forwards to /login?next=… — avoiding a second round-trip from the layout.
    const url = request.nextUrl.clone();
    url.pathname = BFF.auth.refresh;
    url.search = '';
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (isAuthPage(pathname) && hasAccess && pathname !== PAGES.resetPassword) {
    const url = request.nextUrl.clone();
    url.pathname = PAGES.dashboard;
    url.search = '';
    return NextResponse.redirect(url);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, `${pathname}${search}`);
  return NextResponse.next({ request: { headers: requestHeaders } });
};

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/profile/:path*',
    '/notifications/:path*',
    '/security/:path*',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
  ],
};
