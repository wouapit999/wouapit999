'use server';

import { z } from 'zod';

import { createAction } from '@/lib/server-action';
import { isCurrencyCode } from '@/server/money';
import {
  PARTNER_TYPES,
  createPartner,
  createSettlement,
  reviewPartner,
  updatePartner,
} from '@/server/partners';

const LIST = '/admin/partners';
const bps = z.coerce
  .number('Enter basis points')
  .int('Whole basis points only')
  .min(0)
  .max(1000, 'At most 1000 bps (10%)');

/** Onboard a partner, merchant or agent directly as ACTIVE (`partners:write`). */
export const createPartnerAction = createAction({
  schema: z.object({
    type: z.enum(PARTNER_TYPES, 'Choose a type'),
    name: z.string().trim().min(2, 'Enter the business name').max(120),
    legalName: z.string().trim().max(160).optional(),
    countryCode: z.string().trim().toUpperCase().length(2, 'Choose a country'),
    contactEmail: z.string().trim().max(200),
    contactPhone: z.string().trim().max(40).optional(),
    website: z.string().trim().max(200).optional(),
    description: z.string().trim().max(1000).optional(),
    commissionBps: bps.default(0),
    ownerName: z.string().trim().max(120).optional(),
    ownerPassword: z.string().max(128).optional(),
  }),
  permission: 'partners:write',
  handler: async (input, ctx) => {
    const partner = await createPartner(ctx, input);
    return { id: partner.id };
  },
  revalidate: [LIST],
  redirectTo: (result) => `${LIST}/${result.id}?created=1`,
});

/** Approve or reject a self-serve application (`partners:write`). */
export const reviewPartnerAction = createAction({
  schema: z
    .object({
      partnerId: z.uuid(),
      decision: z.enum(['APPROVE', 'REJECT']),
      commissionBps: bps.optional(),
      note: z.string().trim().max(1000).optional(),
    })
    .refine((value) => value.decision === 'APPROVE' || Boolean(value.note), {
      message: 'Tell the applicant why the application is rejected',
      path: ['note'],
    }),
  permission: 'partners:write',
  handler: async (input, ctx) => {
    const partner = await reviewPartner(ctx, input.partnerId, {
      decision: input.decision,
      commissionBps: input.commissionBps,
      note: input.note,
    });
    return { id: partner.id, status: partner.status };
  },
  revalidate: (result) => [LIST, `${LIST}/${result.id}`],
  // The application card disappears once reviewed: confirm on the partner's page.
  redirectTo: (result) =>
    `${LIST}/${result.id}?notice=partner-${result.status === 'ACTIVE' ? 'approved' : 'rejected'}`,
});

/** Change the commission rate (`partners:write`). */
export const setCommissionAction = createAction({
  schema: z.object({ partnerId: z.uuid(), commissionBps: bps }),
  permission: 'partners:write',
  handler: async (input, ctx) => {
    const partner = await updatePartner(ctx, input.partnerId, {
      commissionBps: input.commissionBps,
    });
    return { id: partner.id, commissionBps: partner.commissionBps };
  },
  successMessage: (result) =>
    `Commission set to ${result.commissionBps} bps — applies to new transfers`,
  revalidate: (result) => [LIST, `${LIST}/${result.id}`],
});

/** Suspend or reactivate a partner (`partners:write`). */
export const setPartnerStatusAction = createAction({
  schema: z.object({ partnerId: z.uuid(), status: z.enum(['ACTIVE', 'SUSPENDED']) }),
  permission: 'partners:write',
  handler: async (input, ctx) => {
    const partner = await updatePartner(ctx, input.partnerId, { status: input.status });
    return { id: partner.id, status: partner.status };
  },
  revalidate: (result) => [LIST, `${LIST}/${result.id}`],
  redirectTo: (result) => `${LIST}/${result.id}?notice=partner-${result.status.toLowerCase()}`,
});

/**
 * Settlement run for one partner and currency (`settlements:write`): pays every accrued
 * commission into the partner wallet with one balanced journal and records the settlement as
 * PAID in the same transaction.
 */
export const runSettlementAction = createAction({
  schema: z.object({
    partnerId: z.uuid(),
    currency: z.string().trim().toUpperCase().refine(isCurrencyCode, 'Unsupported currency'),
  }),
  permission: 'settlements:write',
  handler: async (input, ctx) => {
    const settlement = await createSettlement(ctx, input);
    return {
      partnerId: settlement.partnerId,
      reference: settlement.reference,
      count: settlement.commissionCount,
    };
  },
  revalidate: (result) => [LIST, `${LIST}/${result.partnerId}`, '/admin/treasury'],
  // The run button is replaced by "Nothing to settle": confirm on the reloaded page.
  redirectTo: (result) => `${LIST}/${result.partnerId}?notice=settlement-paid`,
});
