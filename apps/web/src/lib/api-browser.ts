'use client';

import { ApiClient } from '@/lib/api';
import { BFF } from '@/lib/routes';

/**
 * Browser-side client. Authenticated calls go to the same-origin `/api/proxy/v1/...` handlers,
 * which attach the access-token cookie server-side; on a 401 the client asks
 * `/api/auth/logout`'s sibling `/api/auth/refresh` to rotate the cookies and retries once.
 * The page never sees either token.
 */
let refreshFailedAt = 0;

async function refreshSession(): Promise<boolean> {
  // Avoid hammering the refresh endpoint after a definitive failure (e.g. revoked session).
  if (Date.now() - refreshFailedAt < 5_000) return false;
  try {
    const response = await fetch(BFF.auth.refresh, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    if (response.ok) return true;
    refreshFailedAt = Date.now();
    return false;
  } catch {
    refreshFailedAt = Date.now();
    return false;
  }
}

function readLocaleCookie(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = /(?:^|;\s*)birem_locale=([^;]+)/.exec(document.cookie);
  return match?.[1];
}

/** Client for authenticated API calls (paths include the `/v1` prefix). */
export const proxyApi = new ApiClient({
  baseUrl: BFF.proxy,
  credentials: 'same-origin',
  auth: { getAccessToken: () => null, refresh: refreshSession },
  getLocale: readLocaleCookie,
});

/** Client for the auth BFF routes themselves (`/api/auth/*`); never retries on 401. */
export const authApi = new ApiClient({
  baseUrl: '',
  credentials: 'same-origin',
  getLocale: readLocaleCookie,
});
