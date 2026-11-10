import { AppError } from '@/server/errors';
import { createTransfer, listMyTransfers } from '@/server/transfers';

import { queryObject, readJsonBody, v1Json, v1List, v1Route } from '../_lib/handler';
import {
  IDEMPOTENCY_KEY_PATTERN,
  transferBodySchema,
  transferListQuerySchema,
} from '../_lib/schemas';
import {
  matchesOriginalRequest,
  resolveRecipient,
  resolveSenderWallet,
  serializeSentTransfer,
  serializeTransferListItem,
} from '../_lib/transfers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/transfers — the partner's own transfers (sent, and payments received), newest
 * first. Scope `transfers:read`.
 */
export const GET = v1Route({ scope: 'transfers:read' }, async ({ auth, url }) => {
  const query = transferListQuerySchema.parse(queryObject(url));
  const result = await listMyTransfers(auth.ctx, query);
  return v1List(result.items.map(serializeTransferListItem), {
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
  });
});

/**
 * POST /api/v1/transfers — sends money from the partner's wallet. Scope `transfers:write`.
 *
 * The `Idempotency-Key` header is mandatory: repeating a request with the same key returns the
 * original transfer (`200`, `Idempotent-Replayed: true`) and never debits twice; reusing a key
 * for a different amount or recipient is refused with `409`.
 */
export const POST = v1Route({ scope: 'transfers:write' }, async ({ request, auth }) => {
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
  if (idempotencyKey === '') {
    throw new AppError('VALIDATION', 'The Idempotency-Key header is required', {
      fieldErrors: { 'Idempotency-Key': ['Send a unique key per transfer (8–100 characters)'] },
    });
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new AppError('VALIDATION', 'The Idempotency-Key header is not valid', {
      fieldErrors: { 'Idempotency-Key': ['Use 8–100 characters from A-Z a-z 0-9 _ . : -'] },
    });
  }
  const body = transferBodySchema.parse(await readJsonBody(request));
  const wallet = await resolveSenderWallet(auth, body.sourceCurrency);
  const recipient = await resolveRecipient(body.recipient);

  const { transfer, replayed } = await createTransfer(auth.ctx, {
    senderWalletId: wallet.id,
    recipient,
    amount: body.amount,
    quoteId: body.quoteId,
    idempotencyKey,
    purpose: body.purpose,
    sourceOfFunds: body.sourceOfFunds,
    note: body.note,
  });
  if (replayed && !matchesOriginalRequest(transfer, { amount: body.amount, recipient })) {
    throw new AppError(
      'CONFLICT',
      'This Idempotency-Key was already used for a different transfer',
      { fieldErrors: { 'Idempotency-Key': ['Already used with another amount or recipient'] } },
    );
  }
  return v1Json(serializeSentTransfer(transfer), {
    status: replayed ? 200 : 201,
    headers: {
      location: `/api/v1/transfers/${transfer.reference}`,
      'idempotent-replayed': replayed ? 'true' : 'false',
    },
  });
});
