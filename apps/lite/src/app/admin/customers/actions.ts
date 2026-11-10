'use server';

import { z } from 'zod';

import { reasonField } from '@/components/admin/helpers';
import { createAction } from '@/lib/server-action';
import { assignKycTier } from '@/server/backoffice';
import { STAFF_ROLES } from '@/server/rbac';
import { recalculateUserRisk, setUserStatus, unlockUser } from '@/server/users';

const paths = (userId: string): string[] => [`/admin/customers/${userId}`, '/admin/customers'];

/** Suspend or reactivate a customer account (`users:write`). The service audits the change. */
export const setCustomerStatusAction = createAction({
  schema: z.object({
    userId: z.uuid(),
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    reason: reasonField('Give a reason'),
  }),
  permission: 'users:write',
  handler: async (input, ctx) => {
    const user = await setUserStatus(ctx, input.userId, input.status, input.reason);
    return { id: user.id, status: user.status };
  },
  successMessage: (result) =>
    result.status === 'ACTIVE'
      ? 'Account reactivated'
      : 'Account suspended and signed out everywhere',
  revalidate: (result) => paths(result.id),
});

/** Clear a login lockout (`users:write`). */
export const unlockCustomerAction = createAction({
  schema: z.object({ userId: z.uuid() }),
  permission: 'users:write',
  handler: async (input, ctx) => {
    await unlockUser(ctx, input.userId);
    return { id: input.userId };
  },
  successMessage: 'Lockout cleared',
  revalidate: (result) => paths(result.id),
});

/** Recompute the risk score now (`aml:write` or `users:write`, checked by the service). */
export const recalculateRiskAction = createAction({
  schema: z.object({ userId: z.uuid() }),
  roles: STAFF_ROLES,
  handler: async (input, ctx) => {
    const profile = await recalculateUserRisk(ctx, input.userId);
    return { id: input.userId, score: profile.score, level: profile.level };
  },
  successMessage: (result) => `Risk reassessed: ${result.level} (${result.score})`,
  revalidate: (result) => paths(result.id),
});

/** Manual KYC tier assignment (`kyc:review`). */
export const assignTierAction = createAction({
  schema: z.object({
    userId: z.uuid(),
    tier: z.enum(['TIER_0', 'TIER_1', 'TIER_2']),
    reason: reasonField('Explain the assignment'),
  }),
  permission: 'kyc:review',
  handler: (input, ctx) => assignKycTier(ctx, input.userId, input),
  successMessage: 'Tier assigned',
  revalidate: (result) => [...paths(result.id), '/admin/kyc'],
});
