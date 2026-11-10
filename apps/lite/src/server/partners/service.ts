import { z } from 'zod';

import type { PartnerStatus, PartnerType } from '@/generated/prisma/enums';

import { emailSchema, passwordSchema, phoneSchema } from '../auth/service';
import { writeAudit } from '../audit';
import { hashPassword, hashToken, randomCode, randomToken, timingSafeEqualString } from '../crypto';
import { type DbOrTx, type Prisma, db, withTransaction } from '../db';
import { AppError, isUniqueViolation } from '../errors';
import { getSystemAccountIds, lockAccounts, postJournal } from '../ledger';
import { formatMoney, isCurrencyCode, toBigInt } from '../money';
import { notify, notifyRoles } from '../notifications';
import { RATE_LIMITS, enforceRateLimit } from '../rate-limit';
import { type ActionContext, type ApiKeyActor, actorUserId, assertPermission } from '../rbac';
import { ensurePartnerWallet } from '../wallets';
import { dispatchPartnerEvent, resolvePartnerScope } from './webhooks';

/**
 * Partners, merchants and agents (phase 9): onboarding (self-serve application or by an admin),
 * API keys (shown once, stored hashed), commissions and settlements.
 */

export const PARTNER_TYPES = ['PARTNER', 'MERCHANT', 'AGENT'] as const;
const CODE_PREFIX: Record<PartnerType, string> = { PARTNER: 'P', MERCHANT: 'M', AGENT: 'A' };

const partnerFields = {
  type: z.enum(PARTNER_TYPES),
  name: z.string().trim().min(2, 'Enter the business name').max(120),
  legalName: z.string().trim().max(160).optional(),
  countryCode: z.string().trim().toUpperCase().length(2, 'Choose a country'),
  contactEmail: emailSchema,
  contactPhone: phoneSchema.optional(),
  website: z.url('Enter a valid URL').max(200).optional(),
  description: z.string().trim().max(1000).optional(),
};

export const partnerApplicationSchema = z.object({
  ...partnerFields,
  /** The applicant's own login (role PARTNER). */
  ownerName: z.string().trim().min(2, 'Enter your full name').max(120),
  password: passwordSchema,
});
export type PartnerApplicationInput = z.infer<typeof partnerApplicationSchema>;

export const partnerCreateSchema = z.object({
  ...partnerFields,
  commissionBps: z.coerce.number().int().min(0).max(1000).default(0),
  /** Optional login to create for the partner. */
  ownerName: z.string().trim().min(2).max(120).optional(),
  ownerPassword: passwordSchema.optional(),
});
export type PartnerCreateInput = z.input<typeof partnerCreateSchema>;

async function newPartnerCode(client: DbOrTx, type: PartnerType): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `${CODE_PREFIX[type]}-${randomCode(6)}`;
    const taken = await client.partner.count({ where: { code } });
    if (taken === 0) return code;
  }
  throw new AppError('INTERNAL', 'Could not allocate a partner code');
}

async function requireEnabledCountry(code: string) {
  const country = await db.country.findUnique({ where: { code } });
  if (!country?.enabled) {
    throw new AppError('VALIDATION', 'BI-Rem is not available in this country yet', {
      fieldErrors: { countryCode: ['Choose a supported country'] },
    });
  }
  return country;
}

const duplicateAccount = () =>
  new AppError('CONFLICT', 'An account with this e-mail or phone number already exists', {
    fieldErrors: { contactEmail: ['Already registered'] },
  });

/**
 * Self-serve application: creates the partner as PENDING and a PARTNER login for the applicant.
 * The portal stays read-only until an admin approves. Public (rate limited per IP).
 */
export async function applyForPartner(
  input: PartnerApplicationInput,
  meta: { ip?: string | null; userAgent?: string | null; requestId?: string | null } = {},
) {
  const data = partnerApplicationSchema.parse(input);
  if (meta.ip)
    await enforceRateLimit(`partner-apply:ip:${meta.ip}`, RATE_LIMITS.partnerApplicationPerIp);
  const country = await requireEnabledCountry(data.countryCode);
  const passwordHash = await hashPassword(data.password);
  try {
    return await withTransaction(async (tx) => {
      const partner = await tx.partner.create({
        data: {
          code: await newPartnerCode(tx, data.type),
          type: data.type,
          name: data.name,
          legalName: data.legalName ?? null,
          countryCode: country.code,
          currency: country.currency,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone ?? null,
          website: data.website ?? null,
          description: data.description ?? null,
          status: 'PENDING',
        },
      });
      const user = await tx.user.create({
        data: {
          email: data.contactEmail,
          passwordHash,
          fullName: data.ownerName,
          role: 'PARTNER',
          countryCode: country.code,
          partnerId: partner.id,
        },
        select: { id: true, email: true },
      });
      await notifyRoles(tx, ['ADMIN'], {
        type: 'partner.application',
        title: 'New partner application',
        body: `${partner.name} (${partner.type.toLowerCase()}, ${partner.countryCode})`,
        href: `/admin/partners/${partner.id}`,
      });
      await writeAudit(
        tx,
        {
          actor: {
            type: 'USER',
            id: user.id,
            role: 'PARTNER',
            label: user.email,
            partnerId: partner.id,
          },
          ...meta,
        },
        {
          action: 'partner.apply',
          resourceType: 'partner',
          resourceId: partner.id,
          after: {
            code: partner.code,
            type: partner.type,
            name: partner.name,
            countryCode: partner.countryCode,
          },
        },
      );
      return { partner, userId: user.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateAccount();
    throw error;
  }
}

/** Admin onboarding: creates an ACTIVE partner with its wallet (and optionally a login). */
export async function createPartner(ctx: ActionContext, input: PartnerCreateInput) {
  assertPermission(ctx, 'partners:write');
  const data = partnerCreateSchema.parse(input);
  const country = await requireEnabledCountry(data.countryCode);
  if (data.ownerPassword && !data.ownerName) {
    throw new AppError('VALIDATION', 'Enter the name of the partner user', {
      fieldErrors: { ownerName: ['Required'] },
    });
  }
  const passwordHash = data.ownerPassword ? await hashPassword(data.ownerPassword) : null;
  try {
    return await withTransaction(async (tx) => {
      const partner = await tx.partner.create({
        data: {
          code: await newPartnerCode(tx, data.type),
          type: data.type,
          name: data.name,
          legalName: data.legalName ?? null,
          countryCode: country.code,
          currency: country.currency,
          contactEmail: data.contactEmail,
          contactPhone: data.contactPhone ?? null,
          website: data.website ?? null,
          description: data.description ?? null,
          status: 'ACTIVE',
          commissionBps: data.commissionBps,
          reviewedById: actorUserId(ctx),
          approvedAt: new Date(),
        },
      });
      await ensurePartnerWallet(tx, partner, country.currency);
      if (passwordHash && data.ownerName) {
        await tx.user.create({
          data: {
            email: data.contactEmail,
            passwordHash,
            fullName: data.ownerName,
            role: 'PARTNER',
            countryCode: country.code,
            partnerId: partner.id,
          },
        });
      }
      await writeAudit(tx, ctx, {
        action: 'partner.create',
        resourceType: 'partner',
        resourceId: partner.id,
        after: {
          code: partner.code,
          type: partner.type,
          name: partner.name,
          countryCode: partner.countryCode,
          commissionBps: partner.commissionBps,
        },
      });
      return partner;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateAccount();
    throw error;
  }
}

export const partnerReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  commissionBps: z.coerce.number().int().min(0).max(1000).optional(),
  note: z.string().trim().max(1000).optional(),
});

/** Approves (→ ACTIVE, wallet created) or rejects a PENDING application. `partners:write`. */
export async function reviewPartner(
  ctx: ActionContext,
  partnerId: string,
  input: z.input<typeof partnerReviewSchema>,
) {
  assertPermission(ctx, 'partners:write');
  const data = partnerReviewSchema.parse(input);
  return withTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM partners WHERE id = ${partnerId}::uuid FOR UPDATE`;
    const before = await tx.partner.findUnique({
      where: { id: partnerId },
      include: { users: { select: { id: true } } },
    });
    if (!before) throw new AppError('NOT_FOUND', 'Partner not found');
    if (before.status !== 'PENDING')
      throw new AppError('INVALID_STATE', 'This application has already been reviewed');
    const approved = data.decision === 'APPROVE';
    const after = await tx.partner.update({
      where: { id: partnerId },
      data: {
        status: approved ? 'ACTIVE' : 'REJECTED',
        commissionBps: approved
          ? (data.commissionBps ?? before.commissionBps)
          : before.commissionBps,
        reviewedById: actorUserId(ctx),
        reviewNote: data.note ?? null,
        approvedAt: approved ? new Date() : null,
      },
    });
    if (approved) await ensurePartnerWallet(tx, after, after.currency);
    for (const user of before.users) {
      await notify(tx, {
        userId: user.id,
        type: approved ? 'partner.approved' : 'partner.rejected',
        title: approved ? 'Your partner account is active' : 'Your application was not approved',
        body: approved
          ? `Your code is ${after.code}. You can now create API keys and receive payments.`
          : (data.note ?? 'Please contact support for details.'),
        href: '/partner',
      });
    }
    await writeAudit(tx, ctx, {
      action: approved ? 'partner.approve' : 'partner.reject',
      resourceType: 'partner',
      resourceId: partnerId,
      before: { status: before.status, commissionBps: before.commissionBps },
      after: { status: after.status, commissionBps: after.commissionBps, note: data.note },
    });
    return after;
  });
}

export const partnerUpdateSchema = z.object({
  commissionBps: z.coerce.number().int().min(0).max(1000).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

/** Changes the commission rate or suspends / reactivates a partner. `partners:write`. */
export async function updatePartner(
  ctx: ActionContext,
  partnerId: string,
  input: z.input<typeof partnerUpdateSchema>,
) {
  assertPermission(ctx, 'partners:write');
  const data = partnerUpdateSchema.parse(input);
  return db.$transaction(async (tx) => {
    const before = await tx.partner.findUnique({ where: { id: partnerId } });
    if (!before) throw new AppError('NOT_FOUND', 'Partner not found');
    if (data.status && before.status !== 'ACTIVE' && before.status !== 'SUSPENDED') {
      throw new AppError('INVALID_STATE', 'Only active or suspended partners can change status');
    }
    const after = await tx.partner.update({
      where: { id: partnerId },
      data: {
        ...(data.commissionBps === undefined ? {} : { commissionBps: data.commissionBps }),
        ...(data.status ? { status: data.status } : {}),
      },
    });
    await writeAudit(tx, ctx, {
      action: 'partner.update',
      resourceType: 'partner',
      resourceId: partnerId,
      before: { status: before.status, commissionBps: before.commissionBps },
      after: { status: after.status, commissionBps: after.commissionBps },
    });
    return after;
  });
}

export async function listPartners(
  ctx: ActionContext,
  filter: {
    type?: PartnerType;
    status?: PartnerStatus;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  assertPermission(ctx, 'partners:read');
  const pageSize = Math.min(Math.max(filter.pageSize ?? 25, 1), 100);
  const page = Math.max(filter.page ?? 1, 1);
  const where: Prisma.PartnerWhereInput = {
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.search
      ? {
          OR: [
            { name: { contains: filter.search, mode: 'insensitive' } },
            { code: { contains: filter.search.toUpperCase() } },
            { contactEmail: { contains: filter.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.partner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.partner.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

/** A partner with wallets and users: the actor's own partner, or any for staff (`partners:read`). */
export async function getPartner(ctx: ActionContext, partnerId?: string) {
  const scope = resolvePartnerScope(ctx, partnerId);
  const partner = await db.partner.findUnique({
    where: { id: scope },
    include: {
      wallets: {
        include: { ledgerAccount: { select: { balance: true } } },
        orderBy: { createdAt: 'asc' },
      },
      users: { select: { id: true, email: true, fullName: true, status: true, lastLoginAt: true } },
    },
  });
  if (!partner) throw new AppError('NOT_FOUND', 'Partner not found');
  return partner;
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export const API_KEY_SCOPES = [
  'transfers:read',
  'transfers:write',
  'wallets:read',
  'quotes:write',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeySchema = z.object({
  name: z.string().trim().min(2, 'Name the key').max(80),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, 'Choose at least one scope'),
});

const API_KEY_SELECT = {
  id: true,
  partnerId: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

/**
 * Creates an API key for the actor's partner (must be ACTIVE). The full key is returned ONCE in
 * `secret` (`brl_<prefix>_<random>`); only its sha256 is stored.
 */
export async function createApiKey(
  ctx: ActionContext,
  input: z.infer<typeof apiKeySchema>,
  partnerId?: string,
) {
  const scope = resolvePartnerScope(ctx, partnerId, true);
  const data = apiKeySchema.parse(input);
  const partner = await db.partner.findUnique({ where: { id: scope }, select: { status: true } });
  if (partner?.status !== 'ACTIVE')
    throw new AppError('INVALID_STATE', 'API keys are available once the partner is active');
  const active = await db.apiKey.count({ where: { partnerId: scope, revokedAt: null } });
  if (active >= 10)
    throw new AppError('CONFLICT', 'Revoke an existing key first (maximum 10 active keys)');
  const prefix = randomCode(8).toLowerCase();
  const secret = `brl_${prefix}_${randomToken(32)}`;
  return db.$transaction(async (tx) => {
    const apiKey = await tx.apiKey.create({
      data: {
        partnerId: scope,
        name: data.name,
        prefix,
        keyHash: hashToken(secret),
        scopes: [...new Set(data.scopes)],
        createdById: actorUserId(ctx),
      },
      select: API_KEY_SELECT,
    });
    await writeAudit(tx, ctx, {
      action: 'api_key.create',
      resourceType: 'api_key',
      resourceId: apiKey.id,
      // The key itself never reaches the audit log.
      after: { partnerId: scope, name: apiKey.name, prefix: apiKey.prefix, scopes: apiKey.scopes },
    });
    return { apiKey, secret };
  });
}

export async function listApiKeys(ctx: ActionContext, partnerId?: string) {
  const scope = resolvePartnerScope(ctx, partnerId);
  return db.apiKey.findMany({
    where: { partnerId: scope },
    orderBy: { createdAt: 'desc' },
    select: API_KEY_SELECT,
  });
}

export async function revokeApiKey(ctx: ActionContext, apiKeyId: string): Promise<void> {
  const apiKey = await db.apiKey.findUnique({ where: { id: apiKeyId } });
  if (!apiKey) throw new AppError('NOT_FOUND', 'API key not found');
  try {
    resolvePartnerScope(ctx, apiKey.partnerId, true);
  } catch {
    throw new AppError('NOT_FOUND', 'API key not found');
  }
  if (apiKey.revokedAt) return;
  await db.$transaction(async (tx) => {
    await tx.apiKey.update({ where: { id: apiKeyId }, data: { revokedAt: new Date() } });
    await writeAudit(tx, ctx, {
      action: 'api_key.revoke',
      resourceType: 'api_key',
      resourceId: apiKeyId,
      metadata: { prefix: apiKey.prefix },
    });
  });
}

export interface ApiKeyAuthentication {
  readonly ctx: ActionContext & { readonly actor: ApiKeyActor };
  readonly partner: {
    id: string;
    code: string;
    name: string;
    type: PartnerType;
    currency: string;
    countryCode: string;
  };
  readonly scopes: readonly string[];
}

/**
 * Authenticates `Authorization: Bearer brl_…` for the public API: looks the key up by hash,
 * checks it is not revoked and its partner is ACTIVE, applies the per-key rate limit and returns
 * an `ActionContext` whose actor is the API key. Throws UNAUTHENTICATED / RATE_LIMITED.
 */
export async function authenticateApiKey(
  authorization: string | null | undefined,
  meta: { ip?: string | null; userAgent?: string | null; requestId?: string | null } = {},
): Promise<ApiKeyAuthentication> {
  const match = /^Bearer\s+(brl_[a-z0-9]{8}_[A-Za-z0-9_-]{20,})$/.exec(authorization?.trim() ?? '');
  const invalid = new AppError('UNAUTHENTICATED', 'Missing or invalid API key');
  if (!match?.[1]) throw invalid;
  const keyHash = hashToken(match[1]);
  const apiKey = await db.apiKey.findUnique({ where: { keyHash }, include: { partner: true } });
  // The row is found through the unique index on the hash; the stored hash is then compared
  // again in constant time so the decision never rests on the database comparison alone.
  if (
    !apiKey ||
    !timingSafeEqualString(apiKey.keyHash, keyHash) ||
    apiKey.revokedAt ||
    apiKey.partner.status !== 'ACTIVE'
  ) {
    throw invalid;
  }
  await enforceRateLimit(`api:key:${apiKey.id}`, RATE_LIMITS.apiPerKey);
  // Coarse last-used tracking: at most one write per minute per key.
  if (!apiKey.lastUsedAt || Date.now() - apiKey.lastUsedAt.getTime() > 60_000) {
    await db.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
  return {
    ctx: {
      actor: {
        type: 'API_KEY',
        id: apiKey.id,
        partnerId: apiKey.partnerId,
        label: `${apiKey.partner.code}:${apiKey.prefix}`,
        scopes: apiKey.scopes,
      },
      ...meta,
    },
    partner: {
      id: apiKey.partner.id,
      code: apiKey.partner.code,
      name: apiKey.partner.name,
      type: apiKey.partner.type,
      currency: apiKey.partner.currency,
      countryCode: apiKey.partner.countryCode,
    },
    scopes: apiKey.scopes,
  };
}

/** Throws FORBIDDEN unless the API key holds `scope`. */
export function assertApiScope(auth: ApiKeyAuthentication, scope: ApiKeyScope): void {
  if (!auth.scopes.includes(scope))
    throw new AppError('FORBIDDEN', `This API key lacks the ${scope} scope`);
}

// ---------------------------------------------------------------------------
// Commissions & settlements
// ---------------------------------------------------------------------------

export async function listCommissions(
  ctx: ActionContext,
  filter: {
    partnerId?: string;
    status?: 'ACCRUED' | 'SETTLED' | 'REVERSED';
    page?: number;
    pageSize?: number;
  } = {},
) {
  const scope = resolvePartnerScope(ctx, filter.partnerId);
  const pageSize = Math.min(Math.max(filter.pageSize ?? 25, 1), 100);
  const page = Math.max(filter.page ?? 1, 1);
  const where: Prisma.CommissionWhereInput = {
    partnerId: scope,
    ...(filter.status ? { status: filter.status } : {}),
  };
  const [items, total] = await Promise.all([
    db.commission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        transfer: {
          select: {
            id: true,
            reference: true,
            type: true,
            sendAmount: true,
            sourceCurrency: true,
            senderName: true,
            createdAt: true,
          },
        },
      },
    }),
    db.commission.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

interface CommissionSummaryRow {
  currency: string;
  status: 'ACCRUED' | 'SETTLED' | 'REVERSED';
  amount: bigint;
  count: bigint;
}

/** Commission totals per currency: accrued (payable), settled (paid) and reversed. */
export async function getCommissionSummary(ctx: ActionContext, partnerId?: string) {
  const scope = resolvePartnerScope(ctx, partnerId);
  const rows = await db.$queryRaw<CommissionSummaryRow[]>`
    SELECT currency, status, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count
    FROM commissions WHERE partner_id = ${scope}::uuid
    GROUP BY currency, status ORDER BY currency`;
  const currencies = [...new Set(rows.map((row) => row.currency))];
  return currencies.map((currency) => {
    const pick = (status: CommissionSummaryRow['status']) =>
      rows.find((row) => row.currency === currency && row.status === status);
    return {
      currency,
      accrued: toBigInt(pick('ACCRUED')?.amount),
      accruedCount: Number(toBigInt(pick('ACCRUED')?.count)),
      settled: toBigInt(pick('SETTLED')?.amount),
      settledCount: Number(toBigInt(pick('SETTLED')?.count)),
      reversed: toBigInt(pick('REVERSED')?.amount),
    };
  });
}

export const settlementSchema = z.object({
  partnerId: z.uuid(),
  currency: z.string().trim().toUpperCase().refine(isCurrencyCode, 'Unsupported currency'),
});

/**
 * Pays out every ACCRUED commission of a partner in one currency: one balanced journal
 * (DR commission payable, CR partner wallet), commissions marked SETTLED, a PAID settlement row.
 * `options.until` limits the period to commissions accrued up to that date.
 * Requires `settlements:write`.
 */
export async function createSettlement(
  ctx: ActionContext,
  input: z.input<typeof settlementSchema>,
  options: { now?: Date; until?: Date } = {},
) {
  assertPermission(ctx, 'settlements:write');
  const data = settlementSchema.parse(input);
  const now = options.now ?? new Date();
  const settlement = await withTransaction(async (tx) => {
    const partner = await tx.partner.findUnique({ where: { id: data.partnerId } });
    if (!partner) throw new AppError('NOT_FOUND', 'Partner not found');
    if (partner.status !== 'ACTIVE')
      throw new AppError('INVALID_STATE', 'Only active partners can be settled');
    const wallet = await ensurePartnerWallet(tx, partner, data.currency);
    const payable = (await getSystemAccountIds(tx, data.currency, ['COMMISSION_PAYABLE']))
      .COMMISSION_PAYABLE;
    // Locking the payable account serialises settlements of the same currency.
    await lockAccounts(tx, [payable, wallet.ledgerAccountId]);
    const commissions = await tx.commission.findMany({
      where: {
        partnerId: partner.id,
        currency: data.currency,
        status: 'ACCRUED',
        ...(options.until ? { createdAt: { lte: options.until } } : {}),
      },
      select: { id: true, amount: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const amount = commissions.reduce((total, commission) => total + commission.amount, 0n);
    if (commissions.length === 0 || amount <= 0n) {
      throw new AppError(
        'INVALID_STATE',
        'There is no accrued commission to settle in this currency',
      );
    }
    const reference = `SET-${now.getUTCFullYear()}-${randomCode(8)}`;
    const journal = await postJournal(tx, {
      kind: 'SETTLEMENT',
      description: `Commission settlement ${reference} — ${partner.name}`,
      createdById: actorUserId(ctx),
      postedAt: now,
      lines: [
        { accountId: payable, direction: 'DEBIT', amount },
        { accountId: wallet.ledgerAccountId, direction: 'CREDIT', amount },
      ],
    });
    const created = await tx.settlement.create({
      data: {
        reference,
        partnerId: partner.id,
        currency: data.currency,
        amount,
        commissionCount: commissions.length,
        status: 'PAID',
        periodStart: commissions[0]?.createdAt ?? now,
        periodEnd: commissions[commissions.length - 1]?.createdAt ?? now,
        journalId: journal.journalId,
        createdById: actorUserId(ctx),
        createdAt: now,
        paidAt: now,
      },
    });
    await tx.commission.updateMany({
      where: { id: { in: commissions.map((commission) => commission.id) } },
      data: { status: 'SETTLED', settlementId: created.id },
    });
    const users = await tx.user.findMany({
      where: { partnerId: partner.id, status: 'ACTIVE' },
      select: { id: true },
    });
    for (const user of users) {
      await notify(tx, {
        userId: user.id,
        type: 'settlement.paid',
        title: 'Commission settled',
        body: `${formatMoney(amount, data.currency)} paid to your wallet (${reference}).`,
        href: '/partner/settlements',
        at: now,
      });
    }
    await writeAudit(tx, ctx, {
      action: 'settlement.create',
      resourceType: 'settlement',
      resourceId: created.id,
      at: options.now,
      after: {
        reference,
        partnerId: partner.id,
        currency: data.currency,
        amount,
        commissionCount: commissions.length,
      },
    });
    return created;
  });
  await dispatchPartnerEvent(settlement.partnerId, 'settlement.paid', {
    id: settlement.id,
    reference: settlement.reference,
    currency: settlement.currency,
    amount: settlement.amount.toString(),
    commissionCount: settlement.commissionCount,
    paidAt: settlement.paidAt?.toISOString() ?? null,
  });
  return settlement;
}

export async function listSettlements(
  ctx: ActionContext,
  filter: { partnerId?: string; limit?: number } = {},
) {
  // Staff may list across all partners; partner users only their own.
  const all = !filter.partnerId && ctx.actor.type === 'USER' && ctx.actor.partnerId === null;
  if (all) assertPermission(ctx, 'partners:read');
  const where: Prisma.SettlementWhereInput = all
    ? {}
    : { partnerId: resolvePartnerScope(ctx, filter.partnerId) };
  return db.settlement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(filter.limit ?? 100, 500),
    include: { partner: { select: { id: true, name: true, code: true } } },
  });
}

interface PartnerVolumeRow {
  currency: string;
  count: bigint;
  amount: bigint;
}

/** Headline numbers for the partner portal (and the admin partner page). */
export async function getPartnerDashboard(ctx: ActionContext, partnerId?: string) {
  const scope = resolvePartnerScope(ctx, partnerId);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [partner, commissions, received, sent, apiKeys, endpoints, recentDeliveries] =
    await Promise.all([
      getPartner(ctx, scope),
      getCommissionSummary(ctx, scope),
      db.$queryRaw<PartnerVolumeRow[]>`
      SELECT t.target_currency AS currency, COUNT(*) AS count, COALESCE(SUM(t.receive_amount), 0) AS amount
      FROM transfers t JOIN wallets w ON w.id = t.recipient_wallet_id
      WHERE w.partner_id = ${scope}::uuid AND t.status = 'COMPLETED' AND t.type <> 'TOPUP'
        AND t.created_at >= ${since}
      GROUP BY t.target_currency`,
      db.$queryRaw<PartnerVolumeRow[]>`
      SELECT source_currency AS currency, COUNT(*) AS count, COALESCE(SUM(send_amount), 0) AS amount
      FROM transfers
      WHERE sender_partner_id = ${scope}::uuid AND status = 'COMPLETED' AND type <> 'TOPUP'
        AND created_at >= ${since}
      GROUP BY source_currency`,
      db.apiKey.count({ where: { partnerId: scope, revokedAt: null } }),
      db.webhookEndpoint.count({ where: { partnerId: scope, active: true } }),
      db.webhookDelivery.groupBy({
        by: ['status'],
        where: { endpoint: { partnerId: scope }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);
  const volume = (rows: PartnerVolumeRow[]) =>
    rows.map((row) => ({
      currency: row.currency,
      count: Number(toBigInt(row.count)),
      amount: toBigInt(row.amount),
    }));
  return {
    partner,
    wallets: partner.wallets.map((wallet) => ({
      id: wallet.id,
      currency: wallet.currency,
      balance: wallet.ledgerAccount.balance,
      status: wallet.status,
    })),
    commissions,
    last30Days: { received: volume(received), sent: volume(sent) },
    activeApiKeys: apiKeys,
    activeWebhookEndpoints: endpoints,
    webhookDeliveries: Object.fromEntries(
      recentDeliveries.map((row) => [row.status, row._count._all]),
    ) as Partial<Record<'PENDING' | 'DELIVERED' | 'FAILED', number>>,
  };
}
