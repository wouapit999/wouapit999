import { quoteTransfer } from '@/server/transfers';

import { readJsonBody, v1Json, v1Route } from '../_lib/handler';
import { quoteBodySchema } from '../_lib/schemas';
import { resolveRecipient, resolveSenderWallet, serializeQuote } from '../_lib/transfers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/quotes — prices a transfer and locks fee and FX rate for 15 minutes. Pass the
 * returned `quoteId` to POST /api/v1/transfers. Scope `quotes:write`. No money moves.
 */
export const POST = v1Route({ scope: 'quotes:write' }, async ({ request, auth }) => {
  const body = quoteBodySchema.parse(await readJsonBody(request));
  const wallet = await resolveSenderWallet(auth, body.sourceCurrency);
  const recipient = await resolveRecipient(body.recipient);
  const preview = await quoteTransfer(auth.ctx, {
    senderWalletId: wallet.id,
    recipient,
    amount: body.amount,
  });
  return v1Json(serializeQuote(preview), { status: 201 });
});
