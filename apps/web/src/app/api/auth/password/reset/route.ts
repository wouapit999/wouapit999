import { NextResponse } from 'next/server';

import { passwordResetConfirmSchema } from '@bi-rem/shared/schemas';

import { API } from '@/lib/routes';
import { createPublicApi } from '@/lib/server/api';
import { parseJsonBody, withErrorHandling } from '@/lib/server/handlers';

export const POST = withErrorHandling(async (request: Request) => {
  const body = await parseJsonBody(request, passwordResetConfirmSchema);
  if (!body.ok) return body.response;

  const api = await createPublicApi();
  await api.post(API.auth.passwordReset, body.data, { skipAuthRetry: true });
  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
});
