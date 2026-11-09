import 'server-only';

import { type Locale, isLocale, resolveLocale } from '@bi-rem/shared/constants';

import { COOKIE_NAMES } from '@/lib/server/cookies';

interface CookieReader {
  get(name: string): { value: string } | undefined;
}

interface HeaderReader {
  get(name: string): string | null;
}

/** Locale preference: explicit cookie first, then `Accept-Language`, then the default. */
export function resolveRequestLocale(cookieStore: CookieReader, headerStore: HeaderReader): Locale {
  const fromCookie = cookieStore.get(COOKIE_NAMES.locale)?.value;
  if (fromCookie && isLocale(fromCookie)) {
    return fromCookie;
  }
  return resolveLocale(headerStore.get('accept-language'));
}

/** Current request locale for server components and route handlers. */
export async function getRequestLocale(): Promise<Locale> {
  const { cookies, headers } = await import('next/headers');
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveRequestLocale(cookieStore, headerStore);
}
