import 'server-only';

import { cookies, headers } from 'next/headers';

import { getApiBaseUrl } from '@/env';
import { ApiClient } from '@/lib/api';
import { COOKIE_NAMES } from '@/lib/server/cookies';

/**
 * API client for server components and route handlers. Reads the access token from the request
 * cookies; it never refreshes by itself because server components cannot write cookies — the
 * app layout and `proxy.ts` redirect to `/api/auth/refresh` instead.
 */
export async function createServerApi(accessToken?: string | null): Promise<ApiClient> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const token = accessToken ?? cookieStore.get(COOKIE_NAMES.access)?.value ?? null;
  const forwardedRequestId = headerStore.get('x-request-id');

  return new ApiClient({
    baseUrl: getApiBaseUrl(),
    auth: { getAccessToken: () => token },
    ...(forwardedRequestId ? { requestId: () => forwardedRequestId } : {}),
  });
}

/** Unauthenticated client (login, refresh) built for the current request. */
export function createPublicApi(): ApiClient {
  return new ApiClient({ baseUrl: getApiBaseUrl() });
}
