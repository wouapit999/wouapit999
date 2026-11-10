'use server';

import { z } from 'zod';

import { createAction } from '@/lib/server-action';
import {
  archiveBeneficiary,
  createBeneficiary,
  getBeneficiary,
  updateBeneficiary,
} from '@/server/beneficiaries';
import { AppError } from '@/server/errors';
import { OWN_ACCOUNT_RELATIONSHIP, isLinkedAccount } from '@/server/linked-accounts';
import type { ActionContext } from '@/server/rbac';

/**
 * Beneficiary actions. The service scopes every read and write to the signed-in customer and
 * validates the account (BI-Rem lookup or operator account validation) before saving.
 */

const relationshipSchema = z
  .string()
  .trim()
  .max(60)
  .refine((value) => value.toUpperCase() !== OWN_ACCOUNT_RELATIONSHIP, {
    message: 'To save your own mobile-money number, link it under Wallets',
  })
  .optional();

const addSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter the recipient name').max(120),
    nickname: z.string().trim().max(60).optional(),
    method: z.enum(['WALLET', 'MOBILE_MONEY'], 'Choose how the recipient is paid'),
    accountNumber: z.string().trim().min(3, 'Enter the account').max(254),
    providerId: z.uuid('Choose a mobile-money provider').optional(),
    relationship: relationshipSchema,
  })
  .refine((value) => value.method !== 'MOBILE_MONEY' || value.providerId, {
    message: 'Choose a mobile-money provider',
    path: ['providerId'],
  });

export const addBeneficiaryAction = createAction({
  schema: addSchema,
  roles: ['CUSTOMER'],
  handler: (input, ctx) =>
    createBeneficiary(ctx, {
      ...input,
      // A provider only makes sense for mobile money; ignore a stale hidden value.
      providerId: input.method === 'MOBILE_MONEY' ? input.providerId : undefined,
    }),
  successMessage: (beneficiary) => `${beneficiary.fullName} was added to your beneficiaries.`,
  revalidate: ['/app/beneficiaries', '/app/send'],
});

/** Linked (own) accounts live under Wallets and are never edited through these actions. */
async function assertRegularBeneficiary(ctx: ActionContext, id: string): Promise<void> {
  const beneficiary = await getBeneficiary(ctx, id);
  if (isLinkedAccount(beneficiary)) throw new AppError('NOT_FOUND', 'Beneficiary not found');
}

const updateSchema = z.object({
  id: z.uuid(),
  fullName: z.string().trim().min(2, 'Enter the recipient name').max(120),
  nickname: z.string().trim().max(60).optional(),
  relationship: relationshipSchema,
});

export const updateBeneficiaryAction = createAction({
  schema: updateSchema,
  roles: ['CUSTOMER'],
  handler: async (input, ctx) => {
    await assertRegularBeneficiary(ctx, input.id);
    return updateBeneficiary(ctx, input.id, {
      fullName: input.fullName,
      nickname: input.nickname,
      relationship: input.relationship,
    });
  },
  revalidate: ['/app/beneficiaries', '/app/send'],
  redirectTo: '/app/beneficiaries?updated=1',
});

export const archiveBeneficiaryAction = createAction({
  schema: z.object({ id: z.uuid() }),
  roles: ['CUSTOMER'],
  handler: async (input, ctx) => {
    await assertRegularBeneficiary(ctx, input.id);
    await archiveBeneficiary(ctx, input.id);
  },
  successMessage: 'Beneficiary removed',
  revalidate: ['/app/beneficiaries', '/app/send'],
});
