import type { KycIdType, Role } from '@/generated/prisma/enums';

import { createSarDraft, rejectCase, releaseCase } from '../aml/cases';
import { assessUserRisk } from '../aml/engine';
import type { Db } from '../db';
import { submitKycCase } from '../kyc/service';
import { createSettlement } from '../partners/service';
import { type ActionContext, systemContext } from '../rbac';
import { createTransfer, reverseTransfer, topUpWallet } from '../transfers/engine';
import { moveFloat } from '../treasury';
import { ensurePartnerWallet, ensureUserWallet } from '../wallets';
import { FEE_UNIT } from './reference';

/**
 * Demo data: staff, a merchant / agent / API partner, customers with KYC, funded wallets and
 * 30 days of history. Everything that moves money goes THROUGH the transfer engine (top-ups,
 * transfers, holds, reversals, settlements) with a backdated clock, so the ledger balances and
 * every dashboard, timeline and audit trail is populated by real code paths.
 *
 * Idempotent: users/partners are created only when missing, money movements use fixed
 * idempotency keys, and a `seed.demo` marker in `settings` skips the whole history on re-runs.
 */

const DEMO_MARKER_KEY = 'seed.demo';
const DEMO_VERSION = 1;
const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A valid 1×1 PNG — placeholder "document" for demo KYC cases. */
const DEMO_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

interface DemoCustomer {
  email: string;
  fullName: string;
  phone: string;
  country: string;
  currency: string;
  /** null = leave at tier 0 with a case waiting in the review queue. */
  kyc: { idType: KycIdType; idNumber: string; tier2: boolean } | null;
  pendingKycIdNumber?: string;
  occupation: string;
  city: string;
}

export const DEMO_CUSTOMERS: readonly DemoCustomer[] = [
  {
    email: 'amina@example.com',
    fullName: 'Amina Njoya',
    phone: '+237699000101',
    country: 'CM',
    currency: 'XAF',
    kyc: { idType: 'NATIONAL_ID', idNumber: 'CM-DEMO-100101', tier2: true },
    occupation: 'Pharmacist',
    city: 'Douala',
  },
  {
    email: 'samuel@example.com',
    fullName: 'Samuel Etoga',
    phone: '+237677000104',
    country: 'CM',
    currency: 'XAF',
    kyc: { idType: 'NATIONAL_ID', idNumber: 'CM-DEMO-100104', tier2: false },
    occupation: 'Teacher',
    city: 'Yaoundé',
  },
  {
    email: 'joao@example.com',
    fullName: 'João Baptista',
    phone: '+244923000102',
    country: 'AO',
    currency: 'AOA',
    kyc: { idType: 'NATIONAL_ID', idNumber: 'AO-DEMO-100102', tier2: false },
    occupation: 'Engineer',
    city: 'Luanda',
  },
  {
    email: 'maria@example.com',
    fullName: 'Maria Macuácua',
    phone: '+258841000103',
    country: 'MZ',
    currency: 'MZN',
    kyc: null,
    pendingKycIdNumber: 'MZ-REVIEW-100103',
    occupation: 'Trader',
    city: 'Maputo',
  },
  {
    email: 'paul@example.com',
    fullName: 'Paul Ondo',
    phone: '+241074000105',
    country: 'GA',
    currency: 'XAF',
    kyc: { idType: 'PASSPORT', idNumber: 'GA-DEMO-100105', tier2: false },
    occupation: 'Logistics officer',
    city: 'Libreville',
  },
  {
    email: 'fatou@example.com',
    fullName: 'Fatou Djaló',
    phone: '+245955000106',
    country: 'GW',
    currency: 'XOF',
    kyc: { idType: 'NATIONAL_ID', idNumber: 'GW-DEMO-100106', tier2: false },
    occupation: 'Nurse',
    city: 'Bissau',
  },
];

export const DEMO_STAFF: ReadonlyArray<{
  email: string;
  fullName: string;
  role: Exclude<Role, 'CUSTOMER' | 'PARTNER' | 'ADMIN'>;
}> = [
  { email: 'compliance@bi-rem.local', fullName: 'Claire Compliance (demo)', role: 'COMPLIANCE' },
  { email: 'treasury@bi-rem.local', fullName: 'Thomas Treasury (demo)', role: 'TREASURY' },
  { email: 'support@bi-rem.local', fullName: 'Sarah Support (demo)', role: 'SUPPORT' },
];

export const DEMO_PARTNERS = [
  {
    code: 'M-DEMO01',
    type: 'MERCHANT',
    name: 'Marché Central (demo merchant)',
    contactEmail: 'partner@bi-rem.local',
    commissionBps: 30,
    ownerName: 'Pauline Partner (demo)',
  },
  {
    code: 'A-DEMO01',
    type: 'AGENT',
    name: 'Kiosque Express (demo agent)',
    contactEmail: 'agent@bi-rem.local',
    commissionBps: 40,
    // Has a login so the agent desk (float, cash-in, cash-out) can be tried in the portal.
    ownerName: 'Aïcha Agent (demo)',
  },
  {
    code: 'P-DEMO01',
    type: 'PARTNER',
    name: 'PayLink (demo API partner)',
    contactEmail: 'paylink@bi-rem.local',
    commissionBps: 20,
    ownerName: null,
  },
] as const;

/** Deterministic PRNG (mulberry32) so every environment gets the same demo history. */
function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface DemoSeedResult {
  readonly skipped: boolean;
  readonly transfers: number;
  readonly failures: readonly string[];
}

/**
 * Seeds the demo data set. `passwordHash` is the (already hashed) demo password shared by every
 * demo account. Returns `skipped: true` when the marker says it was done before.
 */
export async function seedDemoData(
  db: Db,
  options: {
    passwordHash: string;
    adminEmail: string;
    now?: Date;
    log?: (message: string) => void;
  },
): Promise<DemoSeedResult> {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? new Date();
  const system = systemContext('seed');
  const start = new Date(now.getTime() - 31 * DAY);

  // --- Accounts (always ensured, even when the history is skipped) -------------------------

  for (const staff of DEMO_STAFF) {
    await db.user.upsert({
      where: { email: staff.email },
      create: {
        email: staff.email,
        fullName: staff.fullName,
        role: staff.role,
        passwordHash: options.passwordHash,
        createdAt: new Date(now.getTime() - 120 * DAY),
      },
      update: {},
    });
  }

  const partners = new Map<string, { id: string; code: string; walletId: string }>();
  for (const seed of DEMO_PARTNERS) {
    const partner = await db.partner.upsert({
      where: { code: seed.code },
      create: {
        code: seed.code,
        type: seed.type,
        name: seed.name,
        legalName: `${seed.name} SARL`,
        countryCode: 'CM',
        currency: 'XAF',
        contactEmail: seed.contactEmail,
        status: 'ACTIVE',
        commissionBps: seed.commissionBps,
        description: 'Demo partner created by the seed.',
        approvedAt: new Date(now.getTime() - 60 * DAY),
        createdAt: new Date(now.getTime() - 62 * DAY),
      },
      update: {},
    });
    const wallet = await ensurePartnerWallet(db, partner, 'XAF');
    partners.set(seed.code, { id: partner.id, code: partner.code, walletId: wallet.id });
    if (seed.ownerName) {
      await db.user.upsert({
        where: { email: seed.contactEmail },
        create: {
          email: seed.contactEmail,
          fullName: seed.ownerName,
          role: 'PARTNER',
          countryCode: 'CM',
          partnerId: partner.id,
          passwordHash: options.passwordHash,
          createdAt: new Date(now.getTime() - 60 * DAY),
        },
        update: {},
      });
    }
  }

  const customers = new Map<
    string,
    { id: string; walletId: string; ctx: ActionContext; seed: DemoCustomer }
  >();
  for (const seed of DEMO_CUSTOMERS) {
    const user = await db.user.upsert({
      where: { email: seed.email },
      create: {
        email: seed.email,
        fullName: seed.fullName,
        phone: seed.phone,
        countryCode: seed.country,
        role: 'CUSTOMER',
        passwordHash: options.passwordHash,
        occupation: seed.occupation,
        city: seed.city,
        createdAt: new Date(now.getTime() - 90 * DAY),
      },
      update: {},
    });
    const wallet = await ensureUserWallet(db, user.id, seed.currency);
    customers.set(seed.email, {
      id: user.id,
      walletId: wallet.id,
      seed,
      ctx: {
        actor: { type: 'USER', id: user.id, role: 'CUSTOMER', label: user.email, partnerId: null },
      },
    });
  }

  const marker = await db.setting.findUnique({ where: { key: DEMO_MARKER_KEY } });
  if (marker) {
    log('demo data already present — history skipped');
    return { skipped: true, transfers: 0, failures: [] };
  }

  const staffCtx = async (email: string): Promise<ActionContext> => {
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    return {
      actor: { type: 'USER', id: user.id, role: user.role, label: user.email, partnerId: null },
    };
  };
  const compliance = await staffCtx('compliance@bi-rem.local');
  const treasury = await staffCtx('treasury@bi-rem.local');
  const admin = await staffCtx(options.adminEmail);

  // --- KYC (simulated vendors) ---------------------------------------------------------------

  const front = {
    kind: 'ID_FRONT' as const,
    fileName: 'demo-id.png',
    mimeType: 'image/png',
    data: DEMO_PNG,
  };
  const address = {
    kind: 'PROOF_OF_ADDRESS' as const,
    fileName: 'demo-address.png',
    mimeType: 'image/png',
    data: DEMO_PNG,
  };
  for (const customer of customers.values()) {
    const { seed } = customer;
    const existing = await db.kycCase.count({ where: { userId: customer.id } });
    if (existing > 0) continue;
    if (seed.kyc) {
      await submitKycCase(
        customer.ctx,
        {
          targetTier: 'TIER_1',
          idType: seed.kyc.idType,
          idNumber: seed.kyc.idNumber,
          idCountry: seed.country,
        },
        [front],
      );
      if (seed.kyc.tier2) {
        await submitKycCase(
          customer.ctx,
          {
            targetTier: 'TIER_2',
            idType: seed.kyc.idType,
            idNumber: seed.kyc.idNumber,
            idCountry: seed.country,
          },
          [front, address],
        );
      }
    } else if (seed.pendingKycIdNumber) {
      await submitKycCase(
        customer.ctx,
        {
          targetTier: 'TIER_1',
          idType: 'NATIONAL_ID',
          idNumber: seed.pendingKycIdNumber,
          idCountry: seed.country,
        },
        [front],
      );
    }
  }

  // --- Float and wallet funding --------------------------------------------------------------

  for (const currency of ['XAF', 'XOF', 'AOA', 'MZN', 'CVE', 'STN'] as const) {
    await moveFloat(
      system,
      {
        currency,
        amount: FEE_UNIT[currency] * 60_000n,
        direction: 'FUND',
        reason: 'Opening float (demo seed)',
      },
      { now: start },
    );
  }
  // Leave the STN float low on purpose so the treasury dashboard shows a liquidity alert.
  await moveFloat(
    system,
    {
      currency: 'STN',
      amount: FEE_UNIT.STN * 56_500n,
      direction: 'WITHDRAW',
      reason: 'Demo: float drawn down',
    },
    { now: new Date(start.getTime() + HOUR) },
  );

  const providerByCode = new Map(
    (await db.provider.findMany({ select: { id: true, code: true } })).map((provider) => [
      provider.code,
      provider.id,
    ]),
  );
  const provider = (code: string): string => {
    const id = providerByCode.get(code);
    if (!id) throw new Error(`Demo seed: provider ${code} is missing`);
    return id;
  };

  const failures: string[] = [];
  let transfers = 0;
  const attempt = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
      transfers += 1;
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  };

  const topUps: ReadonlyArray<[string, string, string, bigint]> = [
    ['amina@example.com', 'mtn-momo-cm', '+237699000101', 6_500_000n],
    ['samuel@example.com', 'orange-money-cm', '+237677000104', 900_000n],
    ['joao@example.com', 'unitel-money-ao', '+244923000102', 3_500_000_00n],
    ['maria@example.com', 'm-pesa-mz', '+258841000103', 12_000_00n],
    ['paul@example.com', 'airtel-money-ga', '+241074000105', 1_200_000n],
    ['fatou@example.com', 'orange-money-gw', '+245955000106', 800_000n],
  ];
  for (const [index, [email, providerCode, account, amount]] of topUps.entries()) {
    const customer = customers.get(email);
    if (!customer) continue;
    await attempt(`top-up ${email}`, () =>
      topUpWallet(
        customer.ctx,
        {
          walletId: customer.walletId,
          providerId: provider(providerCode),
          accountNumber: account,
          amount,
          idempotencyKey: `seed-topup-${index + 1}`,
        },
        { now: new Date(start.getTime() + (2 + index) * HOUR), channel: 'SEED' },
      ),
    );
  }
  // The API partner pre-funds its wallet for disbursements.
  const paylink = partners.get('P-DEMO01');
  if (paylink) {
    await attempt('top-up paylink', () =>
      topUpWallet(
        system,
        {
          walletId: paylink.walletId,
          providerId: provider('mtn-momo-cm'),
          accountNumber: '+237650000900',
          amount: 2_000_000n,
          idempotencyKey: 'seed-topup-paylink',
        },
        { now: new Date(start.getTime() + 9 * HOUR), channel: 'SEED' },
      ),
    );
  }

  // --- 30 days of transfers ------------------------------------------------------------------

  const random = prng(20_261_110);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const between = (min: number, max: number): number => Math.floor(min + random() * (max - min));
  const purposes = [
    'FAMILY_SUPPORT',
    'EDUCATION',
    'MEDICAL',
    'GOODS_AND_SERVICES',
    'GIFT',
  ] as const;
  const funds = ['SALARY', 'BUSINESS_INCOME', 'SAVINGS'] as const;

  type Template = (key: string, at: Date) => Promise<unknown>;
  const send =
    (
      email: string,
      recipient: Parameters<typeof createTransfer>[1]['recipient'],
      amount: () => bigint,
      international: boolean,
    ): Template =>
    (key, at) => {
      const customer = customers.get(email);
      if (!customer) throw new Error(`unknown demo customer ${email}`);
      return createTransfer(
        customer.ctx,
        {
          senderWalletId: customer.walletId,
          recipient,
          amount: amount(),
          idempotencyKey: key,
          ...(international ? { purpose: pick(purposes), sourceOfFunds: pick(funds) } : {}),
        },
        { now: at, channel: 'SEED' },
      );
    };
  const xaf = (min: number, max: number) => () => BigInt(between(min, max) * 500);
  const aoa = (min: number, max: number) => () => BigInt(between(min, max) * 100_00);

  const templates: readonly Template[] = [
    // Domestic
    send('amina@example.com', { kind: 'WALLET', identifier: '+237677000104' }, xaf(10, 120), false),
    send(
      'samuel@example.com',
      { kind: 'WALLET', identifier: 'amina@example.com' },
      xaf(4, 40),
      false,
    ),
    send('amina@example.com', { kind: 'WALLET', identifier: 'M-DEMO01' }, xaf(6, 90), false),
    send('samuel@example.com', { kind: 'WALLET', identifier: 'M-DEMO01' }, xaf(4, 30), false),
    send('amina@example.com', { kind: 'WALLET', identifier: 'A-DEMO01' }, xaf(20, 100), false),
    send(
      'amina@example.com',
      {
        kind: 'MOBILE_MONEY',
        providerId: provider('orange-money-cm'),
        accountNumber: '+237690123450',
        name: 'Brice Kamga',
      },
      xaf(10, 80),
      false,
    ),
    // International, wallet to wallet
    send(
      'amina@example.com',
      { kind: 'WALLET', identifier: 'joao@example.com' },
      xaf(60, 500),
      true,
    ),
    send(
      'joao@example.com',
      { kind: 'WALLET', identifier: 'amina@example.com' },
      aoa(300, 2500),
      true,
    ),
    send(
      'amina@example.com',
      { kind: 'WALLET', identifier: 'paul@example.com' },
      xaf(40, 300),
      true,
    ),
    send(
      'paul@example.com',
      { kind: 'WALLET', identifier: 'fatou@example.com' },
      xaf(20, 160),
      true,
    ),
    send(
      'fatou@example.com',
      { kind: 'WALLET', identifier: 'amina@example.com' },
      xaf(20, 120),
      true,
    ),
    // International, mobile-money payout
    send(
      'amina@example.com',
      {
        kind: 'MOBILE_MONEY',
        providerId: provider('m-pesa-mz'),
        accountNumber: '+258840123456',
        name: 'Tia Rosa Mondlane',
      },
      xaf(40, 260),
      true,
    ),
    send(
      'joao@example.com',
      {
        kind: 'MOBILE_MONEY',
        providerId: provider('e-mola-mz'),
        accountNumber: '+258860123457',
        name: 'Carlos Sitoe',
      },
      aoa(200, 1500),
      true,
    ),
    send(
      'paul@example.com',
      {
        kind: 'MOBILE_MONEY',
        providerId: provider('unitel-money-ao'),
        accountNumber: '+244923123458',
        name: 'Helena Neto',
      },
      xaf(40, 200),
      true,
    ),
    send(
      'amina@example.com',
      {
        kind: 'MOBILE_MONEY',
        providerId: provider('airtel-money-td'),
        accountNumber: '+23566123459',
        name: 'Mahamat Idriss',
      },
      xaf(20, 140),
      true,
    ),
  ];

  let sequence = 0;
  for (let day = 29; day >= 0; day -= 1) {
    const count = between(2, 5);
    for (let slot = 0; slot < count; slot += 1) {
      sequence += 1;
      // Spread through the business day, at least two hours apart (velocity rules stay quiet).
      const at = new Date(
        now.getTime() - day * DAY - (20 - slot * 3) * HOUR + between(0, 50) * 60_000,
      );
      if (at >= now) continue;
      const template = pick(templates);
      await attempt(`transfer #${sequence}`, () => template(`seed-tx-${sequence}`, at));
    }
  }

  // --- Scripted scenarios for the operations and compliance screens --------------------------

  const amina = customers.get('amina@example.com');
  const joao = customers.get('joao@example.com');
  if (amina && joao) {
    const scripted = (
      key: string,
      daysAgo: number,
      input: Omit<Parameters<typeof createTransfer>[1], 'idempotencyKey' | 'senderWalletId'>,
      customer = amina,
    ) =>
      createTransfer(
        customer.ctx,
        { ...input, senderWalletId: customer.walletId, idempotencyKey: key },
        { now: new Date(now.getTime() - daysAgo * DAY), channel: 'SEED' },
      );
    const momo = (code: string, accountNumber: string, name: string) => ({
      kind: 'MOBILE_MONEY' as const,
      providerId: provider(code),
      accountNumber,
      name,
    });

    // Provider failures and one payout still pending at the operator.
    await attempt('failed payout 1', () =>
      scripted('seed-fail-1', 12.4, {
        recipient: momo('mtn-momo-cm', '+237670000001', 'Limit Exceeded (simulated)'),
        amount: 35_000n,
      }),
    );
    await attempt('failed payout 2', () =>
      scripted('seed-fail-2', 6.3, {
        recipient: momo('orange-money-cm', '+237690000002', 'Blocked Account (simulated)'),
        amount: 20_000n,
      }),
    );
    await attempt('failed payout 3', () =>
      scripted('seed-fail-3', 3.2, {
        recipient: momo('unitel-money-ao', '+244923000001', 'Limit Exceeded (simulated)'),
        amount: 60_000n,
        purpose: 'GIFT',
        sourceOfFunds: 'SALARY',
      }),
    );
    await attempt('pending payout', () =>
      scripted('seed-pending-1', 0.08, {
        recipient: momo('mtn-momo-cm', '+237670000006', 'Pending Forever (simulated)'),
        amount: 45_000n,
      }),
    );

    // PEP match: flagged, alert left open for the compliance queue.
    await attempt('pep flag', () =>
      scripted('seed-pep-1', 2.1, {
        recipient: momo('unitel-money-ao', '+244923111222', 'Honorable Sample Ministro'),
        amount: 80_000n,
        purpose: 'GIFT',
        sourceOfFunds: 'SAVINGS',
      }),
    );

    // Large transfer held, then released by compliance.
    await attempt('hold → release', async () => {
      const { transfer } = await scripted('seed-hold-release', 9.5, {
        recipient: { kind: 'WALLET', identifier: 'joao@example.com' },
        amount: 1_900_000n,
        purpose: 'BUSINESS',
        sourceOfFunds: 'BUSINESS_INCOME',
      });
      const amlCase = await db.amlCase.findFirst({ where: { transferId: transfer.id } });
      if (amlCase)
        await releaseCase(
          compliance,
          amlCase.id,
          'Invoice and bank statement reviewed (demo seed).',
        );
    });

    // Sanctions name match held, then rejected with a SAR draft.
    await attempt('hold → reject', async () => {
      const { transfer } = await scripted('seed-hold-reject', 5.6, {
        recipient: momo('airtel-money-td', '+23566777888', 'Ibrahim Testcase Al-Fictif'),
        amount: 150_000n,
        purpose: 'OTHER',
        sourceOfFunds: 'OTHER',
      });
      const amlCase = await db.amlCase.findFirst({ where: { transferId: transfer.id } });
      if (amlCase) {
        await rejectCase(
          compliance,
          amlCase.id,
          'Recipient matches the demo sanctions list (demo seed).',
        );
        await createSarDraft(
          compliance,
          amlCase.id,
          'Demo SAR draft: customer attempted a payout to a name on the (fictional) demo sanctions list.',
        );
      }
    });

    // Two transfers still on hold, waiting in the compliance queue.
    await attempt('hold (open) 1', () =>
      scripted('seed-hold-open-1', 0.6, {
        recipient: { kind: 'WALLET', identifier: '+237677000104' },
        amount: 1_850_000n,
      }),
    );
    await attempt('hold (open) 2', () =>
      scripted('seed-hold-open-2', 0.3, {
        recipient: momo('m-pesa-mz', '+258840999111', 'Viktor Demo Sanctionov'),
        amount: 90_000n,
        purpose: 'OTHER',
        sourceOfFunds: 'SAVINGS',
      }),
    );

    // A reversal by an administrator.
    await attempt('reversal', async () => {
      const { transfer } = await scripted('seed-reverse-1', 14.2, {
        recipient: { kind: 'WALLET', identifier: 'M-DEMO01' },
        amount: 75_000n,
      });
      if (transfer.status === 'COMPLETED') {
        await reverseTransfer(admin, transfer.id, 'Customer paid the wrong merchant (demo seed).', {
          now: new Date(now.getTime() - 14 * DAY),
        });
      }
    });
  }

  // API partner disbursements (channel API in the reports).
  if (paylink) {
    const apiCtx: ActionContext = {
      actor: {
        type: 'API_KEY',
        id: paylink.id,
        partnerId: paylink.id,
        label: 'P-DEMO01:seed',
        scopes: ['transfers:write'],
      },
    };
    for (const [index, phone] of ['+237699000101', '+237677000104', '+237699000101'].entries()) {
      await attempt(`api disbursement ${index + 1}`, () =>
        createTransfer(
          apiCtx,
          {
            senderWalletId: paylink.walletId,
            recipient: { kind: 'WALLET', identifier: phone },
            amount: BigInt(50_000 + index * 25_000),
            idempotencyKey: `seed-api-${index + 1}`,
          },
          { now: new Date(now.getTime() - (18 - index * 6) * DAY), channel: 'API' },
        ),
      );
    }
  }

  // Commission settlement for the merchant, ten days ago; later commissions stay accrued.
  const merchant = partners.get('M-DEMO01');
  if (merchant) {
    const settleAt = new Date(now.getTime() - 10 * DAY);
    const accrued = await db.commission.count({
      where: { partnerId: merchant.id, status: 'ACCRUED', createdAt: { lte: settleAt } },
    });
    if (accrued > 0) {
      await attempt('settlement', () =>
        createSettlement(
          treasury,
          { partnerId: merchant.id, currency: 'XAF' },
          { now: settleAt, until: settleAt },
        ),
      );
    }
  }

  for (const customer of customers.values()) await assessUserRisk(db, customer.id, now);

  await db.setting.upsert({
    where: { key: DEMO_MARKER_KEY },
    create: {
      key: DEMO_MARKER_KEY,
      value: { version: DEMO_VERSION, seededAt: now.toISOString(), transfers },
      description: 'Marker: demo data has been seeded',
    },
    update: { value: { version: DEMO_VERSION, seededAt: now.toISOString(), transfers } },
  });
  log(`demo data seeded: ${transfers} money movements, ${failures.length} skipped`);
  return { skipped: false, transfers, failures };
}
