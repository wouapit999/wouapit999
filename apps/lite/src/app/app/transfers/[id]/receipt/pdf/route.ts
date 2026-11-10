import { z } from 'zod';

import { apiHandler, fileResponse } from '@/lib/http';
import { getActionContext } from '@/server/auth/session';
import { AppError } from '@/server/errors';
import { getReceiptPdf } from '@/server/receipts';

export const runtime = 'nodejs';

/**
 * PDF receipt of a transfer. Ownership is enforced by `getReceiptPdf` → `getTransferDetail`:
 * only the sender (or the recipient, once the money arrived) gets a document; for everybody
 * else the answer is the same 404 as for a transfer that does not exist.
 */
export const GET = apiHandler(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const ctx = await getActionContext();
    if (ctx.actor.type !== 'USER' || ctx.actor.role !== 'CUSTOMER') {
      throw new AppError('NOT_FOUND', 'Transfer not found');
    }
    const id = z.uuid().safeParse((await context.params).id);
    if (!id.success) throw new AppError('NOT_FOUND', 'Transfer not found');
    const receipt = await getReceiptPdf(ctx, id.data);
    return fileResponse(receipt.data, {
      contentType: 'application/pdf',
      fileName: receipt.fileName,
    });
  },
);
