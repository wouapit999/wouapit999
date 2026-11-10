'use server';

import { z } from 'zod';

import { createAction } from '@/lib/server-action';
import { reviewKycCase } from '@/server/kyc';

/** Approve, reject or ask to resubmit a case in review (`kyc:review`). Audited by the service. */
export const reviewKycCaseAction = createAction({
  schema: z.object({
    caseId: z.uuid(),
    decision: z.enum(['APPROVE', 'REJECT', 'RESUBMIT'], 'Choose a decision'),
    note: z.string().trim().min(3, 'Explain the decision').max(1000),
  }),
  permission: 'kyc:review',
  handler: async (input, ctx) => {
    const kycCase = await reviewKycCase(ctx, input.caseId, {
      decision: input.decision,
      note: input.note,
    });
    return { id: kycCase.id, userId: kycCase.userId, status: kycCase.status };
  },
  // The decision form disappears once the case is decided: confirm on the reloaded page.
  redirectTo: (result) => `/admin/kyc/${result.id}?notice=kyc-${result.status.toLowerCase()}`,
  revalidate: (result) => [
    `/admin/kyc/${result.id}`,
    '/admin/kyc',
    `/admin/customers/${result.userId}`,
    '/admin',
  ],
});
