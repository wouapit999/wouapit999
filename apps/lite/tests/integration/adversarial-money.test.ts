import { describe, expect, it } from 'vitest';

import { releaseCase, rejectCase } from '@/server/aml/cases';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { verifyLedgerIntegrity } from '@/server/ledger';
import { toBigInt } from '@/server/money';
import { createSettlement } from '@/server/partners';
import {
  applyProviderOutcome,
  createTransfer,
  quoteTransfer,
  refreshTransferStatus,
  rejectHeldTransfer,
  releaseHeldTransfer,
  reverseTransfer,
  topUpWallet,
} from '@/server/transfers';

import { withTestDatabase } from '../helpers/db';
import {
  type TestCustomer,
  type TestPartner,
  createCustomer,
  createPartner,
  createStaff,
  idem,
  providerId,
  walletBalance,
} from '../helpers/factories';

/**
 * Adversarial money tests (security review): races between state changes of one transfer,
 * quote abuse and a randomised property test. The invariants are checked against the real
 * ledger tables, not against what the services report.
 */

withTestDatabase();

interface BalanceRow {
  currency: string;
  balance: bigint;
}
interface SumRow {
  currency: string;
  total: unknown;
}

const systemBalances = async (type: string): Promise<Map<string, bigint>> => {
  const rows = await db.$queryRaw<BalanceRow[]>`
    SELECT currency, balance FROM ledger_accounts WHERE type::text = ${type}`;
  return new Map(rows.map((row) => [row.currency, row.balance]));
};

const asMap = (rows: SumRow[]): Map<string, bigint> =>
  new Map(rows.map((row) => [row.currency, toBigInt(row.total)]));

/**
 * Every books-level invariant the money movement rules promise:
 *  - debits = credits per currency, every journal balanced, no drift, no negative wallet;
 *  - SUSPENSE holds exactly the funds of in-flight / held transfers;
 *  - FEE_REVENUE and FX_REVENUE hold exactly the fees and margins of completed transfers;
 *  - COMMISSION_PAYABLE holds exactly the accrued (unsettled, unreversed) commissions.
 */
async function expectSoundBooks(): Promise<void> {
  const integrity = await verifyLedgerIntegrity();
  expect(integrity.length).toBeGreaterThan(0);
  for (const row of integrity) {
    expect(row, `ledger integrity for ${row.currency}`).toMatchObject({
      balanced: true,
      unbalancedJournals: 0,
      driftingAccounts: 0,
      negativeWallets: 0,
    });
    expect(row.totalDebits - row.totalCredits, `net of all entries in ${row.currency}`).toBe(0n);
  }

  const reserved = asMap(
    await db.$queryRaw<SumRow[]>`
      SELECT source_currency AS currency, SUM(total_debit) AS total FROM transfers
      WHERE type <> 'TOPUP' AND status IN ('PROCESSING', 'ON_HOLD') GROUP BY source_currency`,
  );
  const fees = asMap(
    await db.$queryRaw<SumRow[]>`
      SELECT source_currency AS currency, SUM(fee_amount) AS total FROM transfers
      WHERE status = 'COMPLETED' GROUP BY source_currency`,
  );
  const margins = asMap(
    await db.$queryRaw<SumRow[]>`
      SELECT source_currency AS currency, SUM(fx_margin_amount) AS total FROM transfers
      WHERE status = 'COMPLETED' AND source_currency <> target_currency GROUP BY source_currency`,
  );
  const accrued = asMap(
    await db.$queryRaw<SumRow[]>`
      SELECT currency, SUM(amount) AS total FROM commissions
      WHERE status = 'ACCRUED' GROUP BY currency`,
  );
  const checks: Array<[string, Map<string, bigint>]> = [
    ['SUSPENSE', reserved],
    ['FEE_REVENUE', fees],
    ['FX_REVENUE', margins],
    ['COMMISSION_PAYABLE', accrued],
  ];
  for (const [type, expected] of checks) {
    for (const [currency, balance] of await systemBalances(type)) {
      expect(balance, `${type} ${currency}`).toBe(expected.get(currency) ?? 0n);
    }
  }
}

const codeOf = (error: unknown): string =>
  error instanceof AppError ? error.code : `UNEXPECTED:${String(error)}`;

/** Runs racing operations to completion; `ok` or the AppError code of each. */
const settle = async (
  promises: Array<Promise<unknown>>,
): Promise<Array<{ ok: true } | { ok: false; code: string }>> => {
  const results = await Promise.allSettled(promises);
  return results.map((result) =>
    result.status === 'fulfilled' ? { ok: true } : { ok: false, code: codeOf(result.reason) },
  );
};

// ≈ USD 3 293 — above the "large transfer" rule, so the transfer is held.
const LARGE = 2_000_000n;

describe('races between state changes of one transfer', () => {
  it('a reversal racing the recipient spending the money: exactly one of them wins', async () => {
    const admin = await createStaff('ADMIN');
    for (let round = 0; round < 6; round += 1) {
      const sender = await createCustomer({ balance: 200_000n });
      const recipient = await createCustomer();
      const third = await createCustomer();
      const { transfer } = await createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: { kind: 'WALLET', identifier: recipient.phone },
        amount: 100_000n,
        idempotencyKey: idem('race-rev'),
      });
      expect(transfer.status).toBe('COMPLETED');

      const [reversal, spend] = await settle([
        reverseTransfer(admin.ctx, transfer.id, 'Customer reported fraud'),
        createTransfer(recipient.ctx, {
          senderWalletId: recipient.walletId,
          recipient: { kind: 'WALLET', identifier: third.phone },
          amount: 99_000n,
          idempotencyKey: idem('race-spend'),
        }),
      ]);
      // Both cannot succeed: the recipient only ever held 100 000.
      expect(Number(reversal?.ok) + Number(spend?.ok), `round ${round}`).toBe(1);
      if (!reversal?.ok) expect(reversal?.code).toBe('INSUFFICIENT_FUNDS');
      if (!spend?.ok) expect(spend?.code).toBe('INSUFFICIENT_FUNDS');
      expect(await walletBalance(recipient.walletId)).toBeGreaterThanOrEqual(0n);
      const total =
        (await walletBalance(sender.walletId)) +
        (await walletBalance(recipient.walletId)) +
        (await walletBalance(third.walletId));
      // Money is conserved between the three wallets, less the fees actually kept.
      const spent = await db.transfer.findFirst({ where: { senderUserId: recipient.id } });
      const kept = reversal?.ok ? 0n : transfer.feeAmount + (spent?.feeAmount ?? 0n);
      expect(total).toBe(200_000n - kept);
    }
    await expectSoundBooks();
  });

  it('reversing the same transfer twice in parallel reverses it once', async () => {
    const admin = await createStaff('ADMIN');
    const sender = await createCustomer({ balance: 500_000n });
    const merchant = await createPartner({ type: 'MERCHANT', commissionBps: 40 });
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: merchant.code },
      amount: 100_000n,
      idempotencyKey: idem('double-rev'),
    });
    const results = await settle(
      Array.from({ length: 5 }, () => reverseTransfer(admin.ctx, transfer.id, 'Duplicate payment')),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    for (const result of results) if (!result.ok) expect(result.code).toBe('INVALID_STATE');
    expect(await walletBalance(sender.walletId)).toBe(500_000n);
    expect(await walletBalance(merchant.walletId)).toBe(0n);
    await expect(
      reverseTransfer(admin.ctx, transfer.id, 'A third attempt later'),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expectSoundBooks();
  });

  it('release racing reject of one held transfer: one decision, funds moved once', async () => {
    const compliance = await createStaff('COMPLIANCE');
    for (const viaCase of [true, false]) {
      for (let round = 0; round < 4; round += 1) {
        const sender = await createCustomer({ balance: 5_000_000n });
        const recipient = await createCustomer();
        const { transfer } = await createTransfer(sender.ctx, {
          senderWalletId: sender.walletId,
          recipient: { kind: 'WALLET', identifier: recipient.phone },
          amount: LARGE,
          idempotencyKey: idem('race-hold'),
        });
        expect(transfer.status).toBe('ON_HOLD');
        const amlCase = await db.amlCase.findFirstOrThrow({ where: { transferId: transfer.id } });

        const results = await settle(
          viaCase
            ? [
                releaseCase(compliance.ctx, amlCase.id, 'Documents verified').then(
                  (r) => r.transfer,
                ),
                rejectCase(compliance.ctx, amlCase.id, 'Suspicious pattern').then(
                  (r) => r.transfer,
                ),
                releaseCase(compliance.ctx, amlCase.id, 'Documents verified').then(
                  (r) => r.transfer,
                ),
              ]
            : [
                releaseHeldTransfer(compliance.ctx, transfer.id, 'Documents verified'),
                rejectHeldTransfer(compliance.ctx, transfer.id, 'Suspicious pattern'),
                rejectHeldTransfer(compliance.ctx, transfer.id, 'Suspicious pattern'),
              ],
        );
        expect(results.filter((result) => result.ok)).toHaveLength(1);
        for (const result of results) if (!result.ok) expect(result.code).toBe('INVALID_STATE');

        const final = await db.transfer.findUniqueOrThrow({ where: { id: transfer.id } });
        const senderBalance = await walletBalance(sender.walletId);
        const recipientBalance = await walletBalance(recipient.walletId);
        if (final.status === 'COMPLETED') {
          expect(senderBalance).toBe(5_000_000n - transfer.totalDebit);
          expect(recipientBalance).toBe(LARGE);
        } else {
          expect(final.status).toBe('REJECTED');
          expect(senderBalance).toBe(5_000_000n);
          expect(recipientBalance).toBe(0n);
        }
      }
    }
    await expectSoundBooks();
  });

  it('conflicting provider outcomes (webhook SUCCESS vs poll FAILED) apply exactly once', async () => {
    const mtn = await providerId('mtn-momo-cm');
    for (let round = 0; round < 6; round += 1) {
      const sender = await createCustomer({ balance: 300_000n });
      const { transfer } = await createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        // Suffix 0006: the simulator keeps the payout pending until told otherwise.
        recipient: {
          kind: 'MOBILE_MONEY',
          providerId: mtn,
          accountNumber: '+237670010006',
          name: 'Pending Payee',
        },
        amount: 50_000n,
        idempotencyKey: idem('race-outcome'),
      });
      expect(transfer.status).toBe('PROCESSING');
      await Promise.all([
        applyProviderOutcome(
          transfer.id,
          { status: 'SUCCESS', providerRef: 'P-1' },
          { source: 'WEBHOOK' },
        ),
        applyProviderOutcome(
          transfer.id,
          { status: 'FAILED', providerRef: 'P-1', failureCode: 'X', failureReason: 'declined' },
          { source: 'POLL' },
        ),
        applyProviderOutcome(
          transfer.id,
          { status: 'SUCCESS', providerRef: 'P-1' },
          { source: 'WEBHOOK' },
        ),
      ]);
      const final = await db.transfer.findUniqueOrThrow({ where: { id: transfer.id } });
      expect(['COMPLETED', 'FAILED']).toContain(final.status);
      expect(await walletBalance(sender.walletId)).toBe(
        final.status === 'COMPLETED' ? 300_000n - transfer.totalDebit : 300_000n,
      );
      const journals = await db.journal.count({
        where: { transferId: transfer.id, kind: { in: ['RELEASE', 'REFUND'] } },
      });
      expect(journals).toBe(1);
    }
    await expectSoundBooks();
  });

  it('a reversal racing a commission settlement never reverses a commission that was paid out', async () => {
    const admin = await createStaff('ADMIN');
    for (let round = 0; round < 10; round += 1) {
      const sender = await createCustomer({ balance: 500_000n });
      const merchant = await createPartner({ type: 'MERCHANT', commissionBps: 40 });
      const { transfer } = await createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: { kind: 'WALLET', identifier: merchant.code },
        amount: 100_000n,
        idempotencyKey: idem('race-settle'),
      });
      expect(transfer.commissionAmount).toBeGreaterThan(0n);
      await settle([
        createSettlement(admin.ctx, { partnerId: merchant.id, currency: 'XAF' }),
        reverseTransfer(admin.ctx, transfer.id, 'Customer reported fraud'),
      ]);
      const commission = await db.commission.findFirstOrThrow({
        where: { transferId: transfer.id },
      });
      const commissionJournal = await db.journal.findFirstOrThrow({
        where: { transferId: transfer.id, kind: 'COMMISSION' },
        include: { reversal: { select: { id: true } } },
      });
      // Paid out ⇒ the accrual stays on the books; reversed ⇒ it was never paid.
      if (commission.status === 'SETTLED') {
        expect(commission.settlementId, `round ${round}`).not.toBeNull();
        expect(
          commissionJournal.reversal,
          `round ${round}: settled commission reversed`,
        ).toBeNull();
      } else {
        expect(commission.status).toBe('REVERSED');
        expect(commission.settlementId).toBeNull();
        expect(commissionJournal.reversal).not.toBeNull();
      }
    }
    await expectSoundBooks();
  });
});

describe('quote abuse', () => {
  it('a quote cannot be reused, stretched to another amount, or spent by someone else', async () => {
    const sender = await createCustomer({ balance: 1_000_000n });
    const thief = await createCustomer({ balance: 1_000_000n });
    const recipient = await createCustomer({ country: 'AO' });
    const to = { kind: 'WALLET' as const, identifier: recipient.phone };
    const compliance = { purpose: 'GIFT' as const, sourceOfFunds: 'SAVINGS' as const };
    const quote = await quoteTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: to,
      amount: 10_000n,
    });
    const quoteId = quote.quoteId ?? '';

    // Someone else's quote is indistinguishable from a missing one.
    await expect(
      createTransfer(thief.ctx, {
        senderWalletId: thief.walletId,
        recipient: to,
        quoteId,
        idempotencyKey: idem('q'),
        ...compliance,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A different amount than the one quoted.
    await expect(
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: to,
        quoteId,
        amount: 900_000n,
        idempotencyKey: idem('q'),
        ...compliance,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    // A cross-currency quote applied to a domestic recipient.
    await expect(
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: { kind: 'WALLET', identifier: thief.phone },
        quoteId,
        idempotencyKey: idem('q'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    // None of the failed attempts consumed it or moved money.
    expect(await walletBalance(sender.walletId)).toBe(1_000_000n);

    // Two parallel spends of the one quote with different idempotency keys: one transfer.
    const results = await settle([
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: to,
        quoteId,
        idempotencyKey: idem('q'),
        ...compliance,
      }),
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: to,
        quoteId,
        idempotencyKey: idem('q'),
        ...compliance,
      }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ code: 'CONFLICT' });
    expect(await walletBalance(sender.walletId)).toBe(1_000_000n - quote.pricing.totalDebit);
    expect(await walletBalance(recipient.walletId)).toBe(quote.pricing.receiveAmount);

    // An expired quote is dead even if the row still says ACTIVE.
    const stale = await quoteTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: to,
      amount: 10_000n,
    });
    await db.quote.update({
      where: { id: stale.quoteId ?? '' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: to,
        quoteId: stale.quoteId ?? '',
        idempotencyKey: idem('q'),
        ...compliance,
      }),
    ).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
    await expectSoundBooks();
  });
});

// ---------------------------------------------------------------------------
// Randomised property test
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) so a failure can be replayed from the seed. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACCEPTABLE = new Set([
  'INSUFFICIENT_FUNDS',
  'LIMIT_EXCEEDED',
  'KYC_REQUIRED',
  'VALIDATION',
  'UNSUPPORTED',
  'INVALID_STATE',
  'PROVIDER_ERROR',
  'NOT_FOUND',
]);

describe('randomised property test', () => {
  it('several hundred mixed money movements leave every currency summing to zero', async () => {
    const seed = Number(process.env.PROPERTY_SEED ?? 20261110);
    const random = prng(seed);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const admin = await createStaff('ADMIN');
    const compliance = await createStaff('COMPLIANCE');

    const funding: Record<string, bigint> = {
      XAF: 40_000_000n,
      AOA: 6_000_000_00n,
      MZN: 4_000_000_00n,
      CVE: 6_000_000_00n,
      XOF: 40_000_000n,
      STN: 1_500_000_00n,
    };
    const customers: TestCustomer[] = [];
    for (const country of ['CM', 'CM', 'CM', 'GA', 'TD', 'AO', 'AO', 'MZ', 'CV', 'GW', 'ST']) {
      const currency =
        { CM: 'XAF', GA: 'XAF', TD: 'XAF', AO: 'AOA', MZ: 'MZN', CV: 'CVE', GW: 'XOF', ST: 'STN' }[
          country
        ] ?? 'XAF';
      customers.push(await createCustomer({ country, balance: funding[currency] ?? 0n }));
    }
    const merchants: TestPartner[] = [
      await createPartner({ type: 'MERCHANT', commissionBps: 35, balance: 2_000_000n }),
      await createPartner({ type: 'AGENT', commissionBps: 60, balance: 2_000_000n }),
      await createPartner({ type: 'PARTNER', commissionBps: 20, balance: 5_000_000n }),
    ];
    const providers = {
      XAF: await providerId('mtn-momo-cm'),
      AOA: await providerId('unitel-money-ao'),
      MZN: await providerId('m-pesa-mz'),
    };
    const suffixes = ['1111', '2222', '0001', '0002', '0003', '0004', '0005', '0006', '0007'];

    /** Odd, tiny and large amounts: 1 minor unit up to amounts that trip the AML hold. */
    const amountFor = (currency: string): bigint => {
      const scale = currency === 'XAF' || currency === 'XOF' ? 1n : 100n;
      const roll = random();
      if (roll < 0.08) return BigInt(1 + Math.floor(random() * 9));
      if (roll < 0.2) return BigInt(1 + Math.floor(random() * 997));
      if (roll < 0.9)
        return (
          BigInt(1 + Math.floor(random() * 250_000)) * scale + BigInt(Math.floor(random() * 100))
        );
      return (
        BigInt(1_900_000 + Math.floor(random() * 900_000)) * scale +
        BigInt(Math.floor(random() * 100))
      );
    };

    const outcomes = new Map<string, number>();
    const note = (label: string): void => void outcomes.set(label, (outcomes.get(label) ?? 0) + 1);
    const attempt = async (
      label: string,
      run: () => Promise<{ status: string } | null>,
    ): Promise<void> => {
      try {
        const result = await run();
        note(`${label}:${result?.status ?? 'OK'}`);
      } catch (error) {
        const code = codeOf(error);
        if (!ACCEPTABLE.has(code)) throw error;
        note(`${label}:${code}`);
      }
    };
    const compliancePair = { purpose: 'FAMILY_SUPPORT' as const, sourceOfFunds: 'SALARY' as const };

    const STEPS = 360;
    for (let step = 0; step < STEPS; step += 1) {
      const roll = random();
      if (roll < 0.34) {
        // Wallet → wallet between any two customers (domestic or cross-currency).
        const sender = pick(customers);
        const recipient = pick(customers.filter((candidate) => candidate.id !== sender.id));
        await attempt(
          'wallet',
          async () =>
            (
              await createTransfer(sender.ctx, {
                senderWalletId: sender.walletId,
                recipient: { kind: 'WALLET', identifier: recipient.phone },
                amount: amountFor(sender.currency),
                idempotencyKey: idem('prop'),
                ...compliancePair,
              })
            ).transfer,
        );
      } else if (roll < 0.46) {
        // Customer pays a merchant / agent (commission accrues).
        const sender = pick(customers.filter((candidate) => candidate.currency === 'XAF'));
        await attempt(
          'merchant',
          async () =>
            (
              await createTransfer(sender.ctx, {
                senderWalletId: sender.walletId,
                recipient: { kind: 'WALLET', identifier: pick(merchants).code },
                amount: amountFor('XAF'),
                idempotencyKey: idem('prop'),
                ...compliancePair,
              })
            ).transfer,
        );
      } else if (roll < 0.56) {
        // A partner sends (API-style rebate commission), sometimes abroad.
        const partner = pick(merchants);
        const recipient = pick(customers);
        await attempt(
          'partner',
          async () =>
            (
              await createTransfer(partner.ctx, {
                senderWalletId: partner.walletId,
                recipient: { kind: 'WALLET', identifier: recipient.phone },
                amount: amountFor('XAF'),
                idempotencyKey: idem('prop'),
                ...compliancePair,
              })
            ).transfer,
        );
      } else if (roll < 0.72) {
        // Mobile-money payout with every simulator scenario, domestic or cross-currency.
        const sender = pick(customers);
        const currency = pick(['XAF', 'AOA', 'MZN'] as const);
        await attempt(
          'payout',
          async () =>
            (
              await createTransfer(sender.ctx, {
                senderWalletId: sender.walletId,
                recipient: {
                  kind: 'MOBILE_MONEY',
                  providerId: providers[currency],
                  accountNumber: `+2376700${10 + Math.floor(random() * 80)}${pick(suffixes)}`,
                  name: 'Simulated Payee',
                },
                amount: amountFor(sender.currency),
                idempotencyKey: idem('prop'),
                ...compliancePair,
              })
            ).transfer,
        );
      } else if (roll < 0.8) {
        // Top-up from mobile money.
        const customer = pick(customers.filter((candidate) => candidate.currency in providers));
        await attempt(
          'topup',
          async () =>
            (
              await topUpWallet(customer.ctx, {
                walletId: customer.walletId,
                providerId: providers[customer.currency as keyof typeof providers],
                accountNumber: `+2376700${10 + Math.floor(random() * 80)}${pick(suffixes)}`,
                amount: amountFor(customer.currency),
                idempotencyKey: idem('prop-topup'),
              })
            ).transfer,
        );
      } else if (roll < 0.86) {
        // Poll a payout / top-up still in flight.
        const pending = await db.transfer.findFirst({
          where: { status: 'PROCESSING' },
          orderBy: { createdAt: 'asc' },
          skip: Math.floor(random() * 3),
        });
        if (pending) await attempt('refresh', () => refreshTransferStatus(admin.ctx, pending.id));
      } else if (roll < 0.93) {
        // Compliance decides a held transfer.
        const held = await db.amlCase.findFirst({
          where: { status: 'OPEN', transfer: { status: 'ON_HOLD' } },
        });
        if (held) {
          const release = random() < 0.5;
          await attempt(
            release ? 'release' : 'reject',
            async () =>
              (
                await (release ? releaseCase : rejectCase)(
                  compliance.ctx,
                  held.id,
                  'Property test decision',
                )
              ).transfer,
          );
        }
      } else if (roll < 0.98) {
        // Reverse a random completed transfer.
        const completed = await db.transfer.findMany({
          where: { status: 'COMPLETED' },
          select: { id: true },
          take: 40,
          orderBy: { createdAt: 'desc' },
        });
        if (completed.length > 0) {
          await attempt('reverse', () =>
            reverseTransfer(admin.ctx, pick(completed).id, 'Property test reversal'),
          );
        }
      } else {
        // Pay out accrued commission.
        await attempt('settlement', async () => {
          await createSettlement(admin.ctx, { partnerId: pick(merchants).id, currency: 'XAF' });
          return null;
        });
      }
      if (step % 60 === 59) await expectSoundBooks();
    }

    await expectSoundBooks();
    // The run must really have exercised the engine, not just bounced off validation.
    const moved = await db.transfer.groupBy({ by: ['status'], _count: true });
    const count = (status: string): number =>
      moved.find((row) => row.status === status)?._count ?? 0;
    expect(count('COMPLETED'), `seed ${seed}: ${JSON.stringify([...outcomes])}`).toBeGreaterThan(
      120,
    );
    expect(count('REVERSED')).toBeGreaterThan(0);
    expect(count('FAILED') + count('REJECTED')).toBeGreaterThan(0);
    expect(
      await db.transfer.count({ where: { sourceCurrency: { not: 'XAF' }, status: 'COMPLETED' } }),
    ).toBeGreaterThan(10);
  }, 240_000);
});
