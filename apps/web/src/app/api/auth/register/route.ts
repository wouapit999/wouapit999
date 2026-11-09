import { NextResponse } from 'next/server';

import { registerSchema, userProfileSchema } from '@bi-rem/shared/schemas';
import { z } from 'zod';

import { authSessionSchema } from '@/lib/auth-schemas';
import { API } from '@/lib/routes';
import { createPublicApi } from '@/lib/server/api';
import { setSessionCookies } from '@/lib/server/cookies';
import { parseJsonBody, withErrorHandling } from '@/lib/server/handlers';

/** The API may auto-login (tokens) or only return the created profile pending email verification. */
const registerResultSchema = z.union([
  authSessionSchema,
  userProfileSchema,
  z.object({ user: userProfileSchema }),
]);

export const POST = withErrorHandling(async (request: Request) => {
  const body = await parseJsonBody(request, registerSchema);
  if (!body.ok) return body.response;

  const api = await createPublicApi();
  const result = await api.post(API.auth.register, body.data, {
    schema: registerResultSchema,
    skipAuthRetry: true,
  });

  if ('accessToken' in result) {
    const response = NextResponse.json(
      { ok: true, authenticated: true, user: result.user ?? null },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    );
    setSessionCookies(response, result);
    return response;
  }

  const user = 'user' in result ? result.user : result;
  return NextResponse.json(
    { ok: true, authenticated: false, user },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
});
