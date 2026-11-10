import { z } from 'zod';

import { apiHandler, fileResponse } from '@/lib/http';
import { getActionContext } from '@/server/auth/session';
import { AppError } from '@/server/errors';
import { getKycDocument } from '@/server/kyc';

export const runtime = 'nodejs';

/**
 * Download of one of the customer's own KYC documents. `getKycDocument` only returns a document
 * to its owner (or a reviewer, who cannot reach `/app`); everything else is a 404. Always served
 * as an attachment with `nosniff`, never rendered inline.
 */
export const GET = apiHandler(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const ctx = await getActionContext();
    if (ctx.actor.type !== 'USER' || ctx.actor.role !== 'CUSTOMER') {
      throw new AppError('NOT_FOUND', 'Document not found');
    }
    const id = z.uuid().safeParse((await context.params).id);
    if (!id.success) throw new AppError('NOT_FOUND', 'Document not found');
    const document = await getKycDocument(ctx, id.data);
    return fileResponse(document.data, {
      contentType: document.mimeType,
      fileName: document.fileName,
    });
  },
);
