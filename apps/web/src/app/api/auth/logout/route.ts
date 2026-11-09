import { type NextRequest, NextResponse } from 'next/server';

import { logoutSchema } from '@bi-rem/shared/schemas';
import { z } from 'zod';

import { ApiError } from '@/lib/api';
import { API } from '@/lib/routes';
import { createServerApi } from '@/lib/server/api';
import { COOKIE_NAMES, clearSessionCookies } from '@/lib/server/cookies';
import { parseJsonBody, withErrorHandling } from '@/lib/server/handlers';

const logoutBodySchema = z.object({ allDevices: z.boolean().default(false) });

export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await parseJsonBody(request, logoutBodySchema);
  if (!body.ok) return body.response;

  const refreshToken = request.cookies.get(COOKIE_NAMES.refresh)?.value;
  const response = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  clearSessionCookies(response);

  // Revoke server-side when we still hold a refresh token; cookie clearing happens regardless.
  if (refreshToken) {
    const api = await createServerApi();
    const dto = logoutSchema.parse({ refreshToken, allDevices: body.data.allDevices });
    try {
      await api.post(API.auth.logout, dto, { skipAuthRetry: true });
    } catch (error) {
      // An already-revoked or expired session is not an error from the user's point of view.
      if (!(error instanceof ApiError && (error.status === 401 || error.status === 404))) {
        throw error;
      }
    }
  }

  return response;
});
