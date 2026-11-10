'use server';

import { z } from 'zod';

import { createAction } from '@/lib/server-action';
import { refreshTransferStatus } from '@/server/transfers';

import { TRANSFER_STATUS_LABELS, labelFor } from '../_lib/labels';

/**
 * Asks the mobile-money operator where a PROCESSING transfer stands and applies the answer
 * (settle or refund). The service only lets the sender — or the owner of a topped-up wallet —
 * do this; for anyone else the transfer does not exist.
 */
export const refreshTransferAction = createAction({
  schema: z.object({ id: z.uuid() }),
  roles: ['CUSTOMER'],
  handler: async (input, ctx) => {
    const transfer = await refreshTransferStatus(ctx, input.id);
    return { id: transfer.id, status: transfer.status };
  },
  successMessage: (result) =>
    result.status === 'PROCESSING'
      ? 'The operator has not confirmed yet. Try again in a moment.'
      : `Status updated: ${labelFor(TRANSFER_STATUS_LABELS, result.status).toLowerCase()}.`,
  revalidate: (result) => [`/app/transfers/${result.id}`, '/app/transfers', '/app/wallets', '/app'],
});
