import { z } from 'zod';

import { apiHandler, fileResponse } from '@/lib/http';
import { getActionContext } from '@/server/auth/session';
import { AppError } from '@/server/errors';
import { getKycDocument } from '@/server/kyc';
import { assertPermission } from '@/server/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Raster images may be shown inline for the preview; everything else is download-only. */
const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * GET /admin/kyc/documents/<id>[?inline=1] — a KYC document for a reviewer.
 *
 * Authorised twice: `kyc:review` here and again in `getKycDocument`, which also writes the
 * audit row for every staff view. Served with `nosniff`, `no-store` and a locked-down CSP so an
 * uploaded file can never run as a page.
 */
export const GET = apiHandler(
  async (request: Request, { params }: { params: Promise<{ documentId: string }> }) => {
    const ctx = await getActionContext();
    assertPermission(ctx, 'kyc:review');
    const { documentId } = await params;
    if (!z.uuid().safeParse(documentId).success) {
      throw new AppError('NOT_FOUND', 'Document not found');
    }
    const document = await getKycDocument(ctx, documentId);
    const inline =
      new URL(request.url).searchParams.get('inline') === '1' &&
      INLINE_TYPES.has(document.mimeType);
    const response = fileResponse(document.data, {
      contentType:
        INLINE_TYPES.has(document.mimeType) || document.mimeType === 'application/pdf'
          ? document.mimeType
          : 'application/octet-stream',
      fileName: document.fileName,
      inline,
    });
    response.headers.set('content-security-policy', "default-src 'none'; sandbox");
    return response;
  },
);
