import { randomUUID } from 'node:crypto';

import type { WalletType } from '@/generated/prisma/enums';

import { type DbOrTx, db } from './db';
import { AppError, isUniqueViolation } from './errors';
import { getAccountStatement } from './ledger';
import { currencyInfo } from './money';
import { type ActionContext, actorPartnerId, hasPermission } from './rbac';

/**
 * Wallets: one per (owner, currency), each backed 1:1 by a CREDIT-normal ledger account that can
 * never go negative. Owners are either a user (customers) or a partner (merchants, agents, API
 * partners).
 */

const WALLET_INCLUDE = {
  ledgerAccount: { select: { id: true, balance: true, currency: true } },
} as const;

async function createWallet(
  client: DbOrTx,
  owner: { userId: string } | { partnerId: string },
  currency: string,
  type: WalletType,
  label: string,
) {
  const info = currencyInfo(currency);
  const id = randomUUID();
  const account = await client.ledgerAccount.create({
    data: {
      code: `WAL:${id}`,
      name: `${label} — ${info.code} wallet`,
      type: 'WALLET',
      currency: info.code,
      normalSide: 'CREDIT',
      allowNegative: false,
    },
    select: { id: true },
  });
  return client.wallet.create({
    data: { id, type, currency: info.code, ledgerAccountId: account.id, ...owner },
    include: WALLET_INCLUDE,
  });
}

/** Returns the user's wallet in `currency`, creating it when missing. */
export async function ensureUserWallet(
  client: DbOrTx,
  userId: string,
  currency: string,
  type: WalletType = 'CUSTOMER',
) {
  const existing = await client.wallet.findUnique({
    where: { userId_currency: { userId, currency } },
    include: WALLET_INCLUDE,
  });
  if (existing) return existing;
  try {
    return await createWallet(client, { userId }, currency, type, 'Customer');
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return client.wallet.findUniqueOrThrow({
      where: { userId_currency: { userId, currency } },
      include: WALLET_INCLUDE,
    });
  }
}

/** Returns the partner's wallet in `currency`, creating it when missing. */
export async function ensurePartnerWallet(
  client: DbOrTx,
  partner: { id: string; type: 'PARTNER' | 'MERCHANT' | 'AGENT'; name: string },
  currency: string,
) {
  const existing = await client.wallet.findUnique({
    where: { partnerId_currency: { partnerId: partner.id, currency } },
    include: WALLET_INCLUDE,
  });
  if (existing) return existing;
  return createWallet(client, { partnerId: partner.id }, currency, partner.type, partner.name);
}

export interface WalletView {
  readonly id: string;
  readonly type: WalletType;
  readonly status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  readonly currency: string;
  readonly balance: bigint;
  readonly ledgerAccountId: string;
  readonly userId: string | null;
  readonly partnerId: string | null;
  readonly createdAt: Date;
}

type WalletRow = Awaited<ReturnType<typeof ensureUserWallet>>;

const toView = (wallet: WalletRow): WalletView => ({
  id: wallet.id,
  type: wallet.type,
  status: wallet.status,
  currency: wallet.currency,
  balance: wallet.ledgerAccount.balance,
  ledgerAccountId: wallet.ledgerAccountId,
  userId: wallet.userId,
  partnerId: wallet.partnerId,
  createdAt: wallet.createdAt,
});

/**
 * True when the actor owns the wallet: the user for user wallets, any user / API key of the
 * partner for partner wallets. Staff with `transfers:read` may read (not move) any wallet.
 */
export function ownsWallet(
  ctx: ActionContext,
  wallet: { userId: string | null; partnerId: string | null },
): boolean {
  if (ctx.actor.type === 'SYSTEM') return true;
  if (wallet.partnerId) return actorPartnerId(ctx) === wallet.partnerId;
  return ctx.actor.type === 'USER' && wallet.userId === ctx.actor.id;
}

/** Wallets the actor owns (their own, or their partner's). */
export async function listMyWallets(ctx: ActionContext): Promise<WalletView[]> {
  if (ctx.actor.type === 'SYSTEM') return [];
  const partnerId = actorPartnerId(ctx);
  const wallets = await db.wallet.findMany({
    where: partnerId
      ? { partnerId }
      : {
          userId: ctx.actor.type === 'USER' ? ctx.actor.id : '00000000-0000-0000-0000-000000000000',
        },
    include: WALLET_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });
  return wallets.map(toView);
}

/** One wallet, if the actor owns it or is staff with `transfers:read`. NOT_FOUND otherwise. */
export async function getWallet(ctx: ActionContext, walletId: string): Promise<WalletView> {
  const wallet = await db.wallet.findUnique({ where: { id: walletId }, include: WALLET_INCLUDE });
  if (!wallet || !(ownsWallet(ctx, wallet) || hasPermission(ctx, 'transfers:read'))) {
    throw new AppError('NOT_FOUND', 'Wallet not found');
  }
  return toView(wallet);
}

/** Statement (ledger entries, newest first) of a wallet the actor may read. */
export async function getWalletStatement(
  ctx: ActionContext,
  walletId: string,
  options: { limit?: number; before?: Date } = {},
) {
  const wallet = await getWallet(ctx, walletId);
  return getAccountStatement(wallet.ledgerAccountId, options);
}

/** Wallets of a given user — staff only (`users:read`). */
export async function listWalletsOfUser(ctx: ActionContext, userId: string): Promise<WalletView[]> {
  if (!hasPermission(ctx, 'users:read'))
    throw new AppError('FORBIDDEN', 'Missing permission users:read');
  const wallets = await db.wallet.findMany({
    where: { userId },
    include: WALLET_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });
  return wallets.map(toView);
}

export interface RecipientWallet {
  readonly walletId: string;
  readonly ledgerAccountId: string;
  readonly type: WalletType;
  readonly currency: string;
  readonly countryCode: string;
  readonly displayName: string;
  readonly userId: string | null;
  readonly partnerId: string | null;
  /** The identifier as stored (normalised phone / e-mail / partner code). */
  readonly account: string;
}

/**
 * Resolves a BI-Rem recipient by phone (`+237…`), e-mail or partner code (`M-…`, `A-…`, `P-…`).
 * Returns null when nobody matches (or the account / wallet is not active). `currency` selects (and, for users, lazily creates) the
 * wallet in that currency; defaults to the recipient's home currency.
 */
export async function findRecipientWallet(
  client: DbOrTx,
  identifier: string,
  currency?: string,
): Promise<RecipientWallet | null> {
  const raw = identifier.trim();
  if (raw === '') return null;

  if (/^[MAP]-[A-Z0-9]{4,12}$/i.test(raw)) {
    const partner = await client.partner.findUnique({ where: { code: raw.toUpperCase() } });
    if (partner?.status !== 'ACTIVE') return null;
    const wallet = await ensurePartnerWallet(client, partner, currency ?? partner.currency);
    if (wallet.status !== 'ACTIVE') return null;
    return {
      walletId: wallet.id,
      ledgerAccountId: wallet.ledgerAccountId,
      type: wallet.type,
      currency: wallet.currency,
      countryCode: partner.countryCode,
      displayName: partner.name,
      userId: null,
      partnerId: partner.id,
      account: partner.code,
    };
  }

  const isEmail = raw.includes('@');
  const phone = raw.replace(/[\s().-]/g, '');
  const user = await client.user.findFirst({
    where: isEmail ? { email: raw.toLowerCase() } : { phone },
    include: { country: { select: { currency: true } } },
  });
  if (user?.role !== 'CUSTOMER' || user.status !== 'ACTIVE' || !user.countryCode || !user.country) {
    return null;
  }
  const wallet = await ensureUserWallet(client, user.id, currency ?? user.country.currency);
  if (wallet.status !== 'ACTIVE') return null;
  return {
    walletId: wallet.id,
    ledgerAccountId: wallet.ledgerAccountId,
    type: wallet.type,
    currency: wallet.currency,
    countryCode: user.countryCode,
    displayName: user.fullName,
    userId: user.id,
    partnerId: null,
    account: isEmail ? user.email : (user.phone ?? user.email),
  };
}
