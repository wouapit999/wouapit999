import { type NextRequest, NextResponse } from 'next/server';

import { logoutSchema, refreshTokenSchema } from '@bi-rem/shared/schemas';
import { z } from 'zod';

import { type ApiClient, ApiError } from '@/lib/api';
import { API } from '@/lib/routes';
import { authSessionSchema } from '@/lib/schemas';
import { createPublicApi, createServerApi } from '@/lib/server/api';
import { COOKIE_NAMES, clearSessionCookies } from '@/lib/server/cookies';
import { parseJsonBody, withErrorHandling } from '@/lib/server/handlers';

const logoutBodySchema = z.object({ allDevices: z.boolean().default(false) });

function isSessionGone(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 404);
}

/**
 * Signs the admin out. The cookies are always cleared; the refresh token is additionally revoked
 * on the API. `POST /v1/auth/logout` requires a valid access token, so when ours has already
 * expired the refresh token is rotated once to obtain a fresh one and the rotated token is what
 * gets revoked — otherwise a 30-day refresh token would outlive the session in the browser.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await parseJsonBody(request, logoutBodySchema);
  if (!body.ok) return body.response;

  const refreshToken = request.cookies.get(COOKIE_NAMES.refresh)?.value;
  const response = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  clearSessionCookies(response);

  if (refreshToken && refreshTokenSchema.safeParse({ refreshToken }).success) {
    await revokeSession(await createServerApi(), refreshToken, body.data.allDevices);
  }

  return response;
});

async function revokeSession(api: ApiClient, refreshToken: string, allDevices: boolean) {
  const revoke = (client: ApiClient, token: string) =>
    client.post(API.auth.logout, logoutSchema.parse({ refreshToken: token, allDevices }), {
      skipAuthRetry: true,
    });

  try {
    await revoke(api, refreshToken);
    return;
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) {
      if (isSessionGone(error)) return;
      throw error;
    }
  }

  // Access token rejected: rotate the refresh token to get a usable bearer, then revoke that.
  let rotated;
  try {
    rotated = await createPublicApi().post(
      API.auth.refresh,
      { refreshToken },
      {
        schema: authSessionSchema,
        skipAuthRetry: true,
      },
    );
  } catch (error) {
    // A rejected refresh token is already unusable; nothing left to revoke.
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return;
    throw error;
  }

  try {
    const fresh = await createServerApi(rotated.accessToken);
    await revoke(fresh, rotated.refreshToken);
  } catch (error) {
    if (!isSessionGone(error)) throw error;
  }
}
