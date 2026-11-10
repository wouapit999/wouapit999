import { getTransferDetail } from '@/server/transfers';

import { v1Json, v1Route } from '../../_lib/handler';
import { referenceParamSchema } from '../../_lib/schemas';
import { serializeTransferDetail } from '../../_lib/transfers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/transfers/{reference} — one transfer by reference (or id) with its timeline.
 * Scope `transfers:read`. A transfer of another partner is a 404, never a 403.
 */
export const GET = v1Route<{ reference: string }>(
  { scope: 'transfers:read' },
  async ({ auth, params }) => {
    const reference = referenceParamSchema.parse(params.reference);
    return v1Json(serializeTransferDetail(await getTransferDetail(auth.ctx, reference)));
  },
);
