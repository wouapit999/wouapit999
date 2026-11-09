import { NextResponse } from 'next/server';

import { loginSchema } from '@bi-rem/shared/schemas';

import {
  type BffSessionResponse,
  isMfaChallenge,
  loginFormSchema,
  loginResultSchema,
} from '@/lib/auth-schemas';
import { API } from '@/lib/routes';
import { createPublicApi } from '@/lib/server/api';
import { setSessionCookies } from '@/lib/server/cookies';
import {
  deviceNameFrom,
  parseJsonBody,
  problemResponse,
  withErrorHandling,
} from '@/lib/server/handlers';

export const POST = withErrorHandling(async (request: Request) => {
  const body = await parseJsonBody(request, loginFormSchema);
  if (!body.ok) return body.response;

  const deviceName = deviceNameFrom(request);
  const dto = loginSchema.parse({
    ...body.data,
    realm: 'CUSTOMER',
    ...(deviceName ? { deviceName } : {}),
  });

  const api = await createPublicApi();
  const result = await api.post(API.auth.login, dto, {
    schema: loginResultSchema,
    skipAuthRetry: true,
  });

  if (isMfaChallenge(result)) {
    // The customer portal does not complete MFA challenges yet; never persist the challenge token.
    return problemResponse({
      type: 'about:blank',
      title: 'Multi-factor authentication required',
      status: 403,
      code: 'MFA_REQUIRED',
      detail: 'This account requires a second factor, which this portal does not support yet.',
    });
  }

  const payload: BffSessionResponse = { ok: true, user: result.user ?? null };
  const response = NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } });
  setSessionCookies(response, result);
  return response;
});
