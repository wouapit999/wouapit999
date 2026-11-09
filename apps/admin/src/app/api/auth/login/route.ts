import { NextResponse } from 'next/server';

import { PAGES } from '@/lib/routes';
import { API } from '@/lib/routes';
import {
  type BffSessionResponse,
  isMfaChallenge,
  loginFormSchema,
  loginResultSchema,
} from '@/lib/schemas';
import { createPublicApi } from '@/lib/server/api';
import { setSessionCookies } from '@/lib/server/cookies';
import { parseJsonBody, problemResponse, withErrorHandling } from '@/lib/server/handlers';

/**
 * Admin login. Forwards `{ email, password }` to `POST /v1/auth/admin/login` and stores the
 * resulting tokens in httpOnly cookies. Customer-realm accounts are rejected by the API itself
 * (the admin endpoint only authenticates the ADMIN realm) and defensively here as well.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const body = await parseJsonBody(request, loginFormSchema);
  if (!body.ok) return body.response;

  const api = createPublicApi();
  const result = await api.post(API.auth.adminLogin, body.data, {
    schema: loginResultSchema,
    skipAuthRetry: true,
  });

  if (isMfaChallenge(result)) {
    // The admin portal does not complete MFA challenges yet; never persist the challenge token.
    return problemResponse({
      type: 'about:blank',
      title: 'Multi-factor authentication required',
      status: 403,
      code: 'MFA_REQUIRED',
      detail: 'This account requires a second factor, which this portal does not support yet.',
    });
  }

  if (result.user && result.user.realm !== 'ADMIN') {
    return problemResponse({
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      code: 'FORBIDDEN',
      detail: `Only administrator accounts can sign in here. Customers use the customer portal (${PAGES.home}).`,
    });
  }

  const payload: BffSessionResponse = { ok: true, user: result.user ?? null };
  const response = NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } });
  setSessionCookies(response, result);
  return response;
});
