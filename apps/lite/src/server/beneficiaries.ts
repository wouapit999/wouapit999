import { z } from 'zod';

import { writeAudit } from './audit';
import { getConnectorForProvider } from './connectors/registry';
import { db } from './db';
import { AppError } from './errors';
import { type ActionContext, requireUserActor } from './rbac';
import { findRecipientWallet } from './wallets';

/**
 * Saved recipients of a customer (phase 2). A beneficiary is either a BI-Rem account (phone,
 * e-mail or merchant/agent code) or a mobile-money account at a provider. Customers only ever
 * see and use their own.
 */

export const beneficiarySchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter the recipient name').max(120),
    nickname: z.string().trim().max(60).optional(),
    method: z.enum(['WALLET', 'MOBILE_MONEY']),
    /** WALLET: phone / e-mail / partner code. MOBILE_MONEY: the operator account number. */
    accountNumber: z.string().trim().min(3).max(254),
    providerId: z.uuid().optional(),
    relationship: z.string().trim().max(60).optional(),
  })
  .refine((value) => value.method !== 'MOBILE_MONEY' || value.providerId, {
    message: 'Choose a mobile-money provider',
    path: ['providerId'],
  });
export type BeneficiaryInput = z.infer<typeof beneficiarySchema>;

const INCLUDE = {
  provider: { select: { id: true, name: true, code: true, adapter: true } },
  country: { select: { code: true, name: true } },
} as const;

export async function listBeneficiaries(ctx: ActionContext) {
  const actor = requireUserActor(ctx);
  return db.beneficiary.findMany({
    where: { userId: actor.id, archivedAt: null },
    orderBy: { fullName: 'asc' },
    include: INCLUDE,
  });
}

export async function getBeneficiary(ctx: ActionContext, id: string) {
  const actor = requireUserActor(ctx);
  const beneficiary = await db.beneficiary.findFirst({
    where: { id, userId: actor.id, archivedAt: null },
    include: INCLUDE,
  });
  if (!beneficiary) throw new AppError('NOT_FOUND', 'Beneficiary not found');
  return beneficiary;
}

/**
 * Saves a recipient after checking it can actually be paid: a WALLET beneficiary must resolve to
 * a BI-Rem account, a MOBILE_MONEY one must pass the provider's account validation.
 */
export async function createBeneficiary(ctx: ActionContext, input: BeneficiaryInput) {
  const actor = requireUserActor(ctx);
  const data = beneficiarySchema.parse(input);

  let countryCode: string;
  let currency: string;
  let accountNumber: string;
  let providerId: string | null = null;

  if (data.method === 'WALLET') {
    const recipient = await findRecipientWallet(db, data.accountNumber);
    if (!recipient) {
      throw new AppError('VALIDATION', 'No BI-Rem account matches this phone, e-mail or code', {
        fieldErrors: { accountNumber: ['No BI-Rem account found'] },
      });
    }
    if (recipient.userId === actor.id) {
      throw new AppError('VALIDATION', 'You cannot add yourself as a beneficiary', {
        fieldErrors: { accountNumber: ['This is your own account'] },
      });
    }
    countryCode = recipient.countryCode;
    currency = recipient.currency;
    accountNumber = recipient.account;
  } else {
    const provider = await db.provider.findUnique({
      where: { id: data.providerId ?? '' },
      include: { country: { select: { enabled: true } } },
    });
    if (provider?.status !== 'ACTIVE' || !provider.supportsPayout || !provider.country.enabled) {
      throw new AppError('VALIDATION', 'This provider is not available', {
        fieldErrors: { providerId: ['Choose an available provider'] },
      });
    }
    accountNumber = data.accountNumber.replace(/[\s().-]/g, '');
    const { connector } = await getConnectorForProvider(provider.id);
    let validation;
    try {
      validation = await connector.validateAccount({ accountNumber, currency: provider.currency });
    } catch {
      throw new AppError(
        'PROVIDER_ERROR',
        `${provider.name} could not validate the account right now`,
      );
    }
    if (!validation.valid) {
      throw new AppError('VALIDATION', validation.reason ?? 'The account could not be validated', {
        fieldErrors: { accountNumber: [validation.reason ?? 'Invalid account'] },
      });
    }
    countryCode = provider.countryCode;
    currency = provider.currency;
    providerId = provider.id;
  }

  const duplicate = await db.beneficiary.findFirst({
    where: { userId: actor.id, archivedAt: null, method: data.method, accountNumber, providerId },
  });
  if (duplicate) {
    throw new AppError('CONFLICT', 'This recipient is already in your beneficiaries', {
      fieldErrors: { accountNumber: ['Already saved'] },
    });
  }

  return db.$transaction(async (tx) => {
    const beneficiary = await tx.beneficiary.create({
      data: {
        userId: actor.id,
        fullName: data.fullName,
        nickname: data.nickname ?? null,
        countryCode,
        currency,
        method: data.method,
        accountNumber,
        providerId,
        relationship: data.relationship ?? null,
      },
      include: INCLUDE,
    });
    await writeAudit(tx, ctx, {
      action: 'beneficiary.create',
      resourceType: 'beneficiary',
      resourceId: beneficiary.id,
      after: {
        fullName: beneficiary.fullName,
        method: beneficiary.method,
        countryCode,
        accountNumber,
      },
    });
    return beneficiary;
  });
}

/** Renames a beneficiary (the account itself is immutable — add a new one instead). */
export async function updateBeneficiary(
  ctx: ActionContext,
  id: string,
  input: { fullName: string; nickname?: string; relationship?: string },
) {
  const actor = requireUserActor(ctx);
  const data = z
    .object({
      fullName: z.string().trim().min(2).max(120),
      nickname: z.string().trim().max(60).optional(),
      relationship: z.string().trim().max(60).optional(),
    })
    .parse(input);
  return db.$transaction(async (tx) => {
    const before = await tx.beneficiary.findFirst({
      where: { id, userId: actor.id, archivedAt: null },
    });
    if (!before) throw new AppError('NOT_FOUND', 'Beneficiary not found');
    const after = await tx.beneficiary.update({
      where: { id },
      data: {
        fullName: data.fullName,
        nickname: data.nickname ?? null,
        relationship: data.relationship ?? null,
      },
      include: INCLUDE,
    });
    await writeAudit(tx, ctx, {
      action: 'beneficiary.update',
      resourceType: 'beneficiary',
      resourceId: id,
      before: {
        fullName: before.fullName,
        nickname: before.nickname,
        relationship: before.relationship,
      },
      after: {
        fullName: after.fullName,
        nickname: after.nickname,
        relationship: after.relationship,
      },
    });
    return after;
  });
}

/** Soft-deletes a beneficiary (kept for the history of past transfers). */
export async function archiveBeneficiary(ctx: ActionContext, id: string): Promise<void> {
  const actor = requireUserActor(ctx);
  await db.$transaction(async (tx) => {
    const result = await tx.beneficiary.updateMany({
      where: { id, userId: actor.id, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new AppError('NOT_FOUND', 'Beneficiary not found');
    await writeAudit(tx, ctx, {
      action: 'beneficiary.archive',
      resourceType: 'beneficiary',
      resourceId: id,
    });
  });
}
