import 'server-only';

import type { NextResponse } from 'next/server';

import { getServerEnv } from '@/env';

/**
 * Session cookies. Both tokens are `httpOnly`, so page scripts never see them. The refresh
 * token is additionally scoped to `/api/auth` so it is only transmitted to the handlers that
 * rotate it, never to pages or the data proxy.
 */
export const COOKIE_NAMES = {
  access: 'birem_access',
  refresh: 'birem_refresh',
  locale: 'birem_locale',
} as const;

export const REFRESH_COOKIE_PATH = '/api/auth';

/** Fallback lifetimes when the API response does not carry `expiresIn`. Mirrors JWT_*_TTL. */
export const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;
export const DEFAULT_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface CookieSettable {
  cookies: Pick<NextResponse['cookies'], 'set' | 'delete'>;
}

function isSecure(): boolean {
  const env = getServerEnv();
  return env.AUTH_COOKIE_SECURE ?? env.NODE_ENV === 'production';
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn?: number | undefined;
}

export function setSessionCookies(response: CookieSettable, tokens: SessionTokens): void {
  const secure = isSecure();
  response.cookies.set({
    name: COOKIE_NAMES.access,
    value: tokens.accessToken,
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: tokens.expiresIn ?? DEFAULT_ACCESS_TTL_SECONDS,
  });
  response.cookies.set({
    name: COOKIE_NAMES.refresh,
    value: tokens.refreshToken,
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: DEFAULT_REFRESH_TTL_SECONDS,
  });
}

export function clearSessionCookies(response: CookieSettable): void {
  const secure = isSecure();
  response.cookies.set({
    name: COOKIE_NAMES.access,
    value: '',
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  response.cookies.set({
    name: COOKIE_NAMES.refresh,
    value: '',
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
  });
}
