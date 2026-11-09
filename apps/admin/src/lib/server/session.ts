import 'server-only';

import { cookies } from 'next/headers';

import { ApiError } from '@/lib/api';
import { API } from '@/lib/routes';
import { type AdminMe, adminMeSchema } from '@/lib/schemas';
import { createServerApi } from '@/lib/server/api';
import { COOKIE_NAMES } from '@/lib/server/cookies';

export type SessionState =
  | { status: 'authenticated'; user: AdminMe }
  | { status: 'expired' }
  | { status: 'forbidden' }
  | { status: 'anonymous' };

/**
 * Resolves the current admin for server components. `expired` means an access token is missing
 * or rejected while a refresh token may still exist, so the caller should bounce through the
 * refresh route handler; `forbidden` means a valid token that does not belong to the ADMIN
 * realm (never trust a customer session on this portal).
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
    const user = await api.get(API.auth.me, { schema: adminMeSchema, skipAuthRetry: true });
    if (user.realm !== 'ADMIN') {
      return { status: 'forbidden' };
    }
    return { status: 'authenticated', user };
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthorized) {
      return { status: 'expired' };
    }
    throw error;
  }
}
