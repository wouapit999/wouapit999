'use client';

import { ApiClient, createAdminApi } from '@/lib/api';
import { BFF } from '@/lib/routes';

/**
 * Browser-side clients. Authenticated calls go to the same-origin `/api/proxy/v1/...` handlers,
 * which attach the access-token cookie server-side; on a 401 the client asks
 * `/api/auth/refresh` to rotate the cookies and retries once. The page never sees either token.
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

/** Client for authenticated API calls (paths include the `/v1` prefix). */
export const proxyApi = new ApiClient({
  baseUrl: BFF.proxy,
  credentials: 'same-origin',
  auth: { getAccessToken: () => null, refresh: refreshSession },
});

/** Resource-level admin API used by the TanStack Query hooks. */
export const adminApi = createAdminApi(proxyApi);

/** Client for the auth BFF routes themselves (`/api/auth/*`); never retries on 401. */
export const authApi = new ApiClient({
  baseUrl: '',
  credentials: 'same-origin',
});
