'use server';

import { z } from 'zod';

import { reasonField } from '@/components/admin/helpers';
import { createAction } from '@/lib/server-action';
import { refreshTransferStatus, reverseTransfer } from '@/server/transfers';

const paths = (id: string): string[] => [
  `/admin/transfers/${id}`,
  '/admin/transfers',
  '/admin/treasury',
  '/admin',
];

/** Reverse a completed transfer with compensating journals (`transfers:reverse`). */
export const reverseTransferAction = createAction({
  schema: z.object({ transferId: z.uuid(), reason: reasonField('Explain the reversal') }),
  permission: 'transfers:reverse',
  handler: async (input, ctx) => {
    const transfer = await reverseTransfer(ctx, input.transferId, input.reason);
    return { id: transfer.id, reference: transfer.reference };
  },
  revalidate: (result) => paths(result.id),
  // The reversal form disappears once the transfer is reversed: confirm on the reloaded page.
  redirectTo: (result) => `/admin/transfers/${result.id}?notice=transfer-reversed`,
});

/** Ask the provider for the outcome of a transfer still in flight (`transfers:refresh`). */
export const refreshTransferAction = createAction({
  schema: z.object({ transferId: z.uuid() }),
  permission: 'transfers:refresh',
  handler: async (input, ctx) => {
    const transfer = await refreshTransferStatus(ctx, input.transferId);
    return { id: transfer.id, status: transfer.status };
  },
  revalidate: (result) => paths(result.id),
  redirectTo: (result) => `/admin/transfers/${result.id}?notice=transfer-refreshed`,
});
