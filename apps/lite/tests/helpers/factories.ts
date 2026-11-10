import { randomBytes } from 'node:crypto';

import type { KycTier, Role } from '@/generated/prisma/enums';
import { db } from '@/server/db';
import { getSystemAccountIds, postJournal } from '@/server/ledger';
import type { ActionContext } from '@/server/rbac';
import { ensurePartnerWallet, ensureUserWallet } from '@/server/wallets';

/**
 * Test factories. They write rows directly (no scrypt, no vendor calls) so tests stay fast;
 * money is always created through the ledger so books stay balanced.
 */

const unique = (): string => randomBytes(5).toString('hex');

/** A password hash that never verifies — factories do not log in. */
const UNUSABLE_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';

const CURRENCY_BY_COUNTRY: Record<string, string> = {
  CM: 'XAF',
  GA: 'XAF',
  TD: 'XAF',
  CG: 'XAF',
  CF: 'XAF',
  GQ: 'XAF',
  AO: 'AOA',
  MZ: 'MZN',
  CV: 'CVE',
  GW: 'XOF',
  ST: 'STN',
};

export interface TestCustomer {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  countryCode: string;
  currency: string;
  walletId: string;
  ledgerAccountId: string;
  ctx: ActionContext;
}

/** Credits a wallet from the float (DR settlement / CR wallet) — the same journal a top-up posts. */
export async function fundWallet(
  ledgerAccountId: string,
  currency: string,
  amount: bigint,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { SETTLEMENT } = await getSystemAccountIds(tx, currency, ['SETTLEMENT']);
    await postJournal(tx, {
      kind: 'TOPUP',
      description: 'Test funding',
      lines: [
        { accountId: SETTLEMENT, direction: 'DEBIT', amount },
        { accountId: ledgerAccountId, direction: 'CREDIT', amount },
      ],
    });
  });
}

export async function createCustomer(
  options: {
    country?: string;
    tier?: KycTier;
    fullName?: string;
    /** Minor units to fund the home-currency wallet with. */
    balance?: bigint;
    /** Days since registration (default 90, so new-account rules stay quiet). */
    ageDays?: number;
  } = {},
): Promise<TestCustomer> {
  const country = options.country ?? 'CM';
  const currency = CURRENCY_BY_COUNTRY[country];
  if (!currency) throw new Error(`No test currency for ${country}`);
  const tier = options.tier ?? 'TIER_2';
  const id = unique();
  const phone = `+2376${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const user = await db.user.create({
    data: {
      email: `customer-${id}@test.local`,
      phone,
      passwordHash: UNUSABLE_HASH,
      fullName: options.fullName ?? `Test Customer ${id}`,
      role: 'CUSTOMER',
      countryCode: country,
      kycTier: tier,
      kycStatus: tier === 'TIER_0' ? 'NONE' : 'VERIFIED',
      createdAt: new Date(Date.now() - (options.ageDays ?? 90) * 86_400_000),
    },
  });
  const wallet = await ensureUserWallet(db, user.id, currency);
  if (options.balance && options.balance > 0n) {
    await fundWallet(wallet.ledgerAccountId, currency, options.balance);
  }
  return {
    id: user.id,
    email: user.email,
    phone,
    fullName: user.fullName,
    countryCode: country,
    currency,
    walletId: wallet.id,
    ledgerAccountId: wallet.ledgerAccountId,
    ctx: {
      actor: { type: 'USER', id: user.id, role: 'CUSTOMER', label: user.email, partnerId: null },
    },
  };
}

export async function createStaff(
  role: Exclude<Role, 'CUSTOMER' | 'PARTNER'> = 'ADMIN',
): Promise<{ id: string; ctx: ActionContext }> {
  const user = await db.user.create({
    data: {
      email: `${role.toLowerCase()}-${unique()}@test.local`,
      passwordHash: UNUSABLE_HASH,
      fullName: `Test ${role}`,
      role,
    },
  });
  return {
    id: user.id,
    ctx: { actor: { type: 'USER', id: user.id, role, label: user.email, partnerId: null } },
  };
}

export interface TestPartner {
  id: string;
  code: string;
  walletId: string;
  ledgerAccountId: string;
  userId: string;
  ctx: ActionContext;
}

export async function createPartner(
  options: {
    type?: 'PARTNER' | 'MERCHANT' | 'AGENT';
    country?: string;
    commissionBps?: number;
    balance?: bigint;
  } = {},
): Promise<TestPartner> {
  const type = options.type ?? 'MERCHANT';
  const country = options.country ?? 'CM';
  const currency = CURRENCY_BY_COUNTRY[country];
  if (!currency) throw new Error(`No test currency for ${country}`);
  const id = unique();
  const partner = await db.partner.create({
    data: {
      code: `${type[0]}-${id.toUpperCase().slice(0, 8)}`,
      type,
      name: `Test ${type} ${id}`,
      countryCode: country,
      currency,
      contactEmail: `partner-${id}@test.local`,
      status: 'ACTIVE',
      commissionBps: options.commissionBps ?? 30,
    },
  });
  const wallet = await ensurePartnerWallet(db, partner, currency);
  if (options.balance && options.balance > 0n) {
    await fundWallet(wallet.ledgerAccountId, currency, options.balance);
  }
  const user = await db.user.create({
    data: {
      email: partner.contactEmail,
      passwordHash: UNUSABLE_HASH,
      fullName: `Owner of ${partner.name}`,
      role: 'PARTNER',
      countryCode: country,
      partnerId: partner.id,
    },
  });
  return {
    id: partner.id,
    code: partner.code,
    walletId: wallet.id,
    ledgerAccountId: wallet.ledgerAccountId,
    userId: user.id,
    ctx: {
      actor: {
        type: 'USER',
        id: user.id,
        role: 'PARTNER',
        label: user.email,
        partnerId: partner.id,
      },
    },
  };
}

export async function providerId(code: string): Promise<string> {
  const provider = await db.provider.findUniqueOrThrow({ where: { code }, select: { id: true } });
  return provider.id;
}

export async function walletBalance(walletId: string): Promise<bigint> {
  const wallet = await db.wallet.findUniqueOrThrow({
    where: { id: walletId },
    include: { ledgerAccount: { select: { balance: true } } },
  });
  return wallet.ledgerAccount.balance;
}

export async function systemBalance(type: string, currency: string): Promise<bigint> {
  const account = await db.ledgerAccount.findUniqueOrThrow({
    where: { code: `SYS:${type}:${currency}` },
  });
  return account.balance;
}

let keyCounter = 0;
/** A fresh, valid idempotency key. */
export const idem = (label = 'test'): string => `${label}-${unique()}-${(keyCounter += 1)}`;
