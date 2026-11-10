import { AppError } from '@/server/errors';
import { getTransferDetail, refreshTransferStatus } from '@/server/transfers';

import { v1Json, v1Route } from '../../../_lib/handler';
import { referenceParamSchema } from '../../../_lib/schemas';
import { serializeTransferDetail } from '../../../_lib/transfers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/transfers/{reference}/refresh — asks the mobile-money provider for the current
 * status of a PROCESSING payout the partner sent and applies it. Scope `transfers:write`.
 * Safe to repeat: a transfer that is no longer PROCESSING is returned unchanged.
 */
export const POST = v1Route<{ reference: string }>(
  { scope: 'transfers:write' },
  async ({ auth, params }) => {
    const reference = referenceParamSchema.parse(params.reference);
    const detail = await getTransferDetail(auth.ctx, reference);
    if (detail.perspective !== 'SENDER') throw new AppError('NOT_FOUND', 'Transfer not found');
    await refreshTransferStatus(auth.ctx, detail.transfer.id);
    return v1Json(serializeTransferDetail(await getTransferDetail(auth.ctx, reference)));
  },
);
