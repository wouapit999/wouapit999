import 'server-only';

import { cookies } from 'next/headers';

import { ApiError } from '@/lib/api';
import { type SessionUser, sessionUserSchema } from '@/lib/auth-schemas';
import { API } from '@/lib/routes';
import { createServerApi } from '@/lib/server/api';
import { COOKIE_NAMES } from '@/lib/server/cookies';

export type SessionState =
  { status: 'authenticated'; user: SessionUser } | { status: 'expired' } | { status: 'anonymous' };

/**
 * Resolves the current user for server components. `expired` means an access token is missing
 * or rejected while a refresh token may still exist, so the caller should bounce through the
 * refresh route handler; `anonymous` means there is nothing to refresh.
 */
export async function getSession(): Promise<SessionState> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(COOKIE_NAMES.access)?.value;
  // The refresh cookie is path-scoped to /api/auth and therefore invisible here; a missing
  // access token is treated as "maybe refreshable" and the refresh handler decides.
  if (!accessToken) {
    return { status: 'expired' };
  }

  const api = await createServerApi(accessToken);
  try {
    const user = await api.get(API.auth.me, { schema: sessionUserSchema, skipAuthRetry: true });
    return { status: 'authenticated', user };
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthorized) {
      return { status: 'expired' };
    }
    throw error;
  }
}
