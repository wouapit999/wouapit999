import { NextResponse } from 'next/server';

import { passwordResetRequestSchema } from '@bi-rem/shared/schemas';

import { ApiError } from '@/lib/api';
import { forgotPasswordFormSchema } from '@/lib/auth-schemas';
import { API } from '@/lib/routes';
import { createPublicApi } from '@/lib/server/api';
import { parseJsonBody, withErrorHandling } from '@/lib/server/handlers';

export const POST = withErrorHandling(async (request: Request) => {
  const body = await parseJsonBody(request, forgotPasswordFormSchema);
  if (!body.ok) return body.response;

  const dto = passwordResetRequestSchema.parse({ email: body.data.email, realm: 'CUSTOMER' });
  const api = await createPublicApi();
  try {
    await api.post(API.auth.passwordForgot, dto, { skipAuthRetry: true });
  } catch (error) {
    // Never reveal whether an account exists: a 404 from the API is answered like a success.
    if (!(error instanceof ApiError && error.status === 404)) {
      throw error;
    }
  }
  return NextResponse.json({ ok: true }, { status: 202, headers: { 'cache-control': 'no-store' } });
});
