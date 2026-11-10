import { describe, expect, it } from 'vitest';

import {
  assignKycTier,
  compareStatements,
  getProviderReconciliation,
  netStatement,
} from '@/server/backoffice';
import type { ConnectorStatementLine } from '@/server/connectors/types';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { setFxRate } from '@/server/fx';
import { resolveRange } from '@/server/reports';
import { createTransfer, reverseTransfer, topUpWallet } from '@/server/transfers';

import { withTestDatabase } from '../helpers/db';
import { createCustomer, createStaff, idem, providerId } from '../helpers/factories';

withTestDatabase();

const code = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    return error instanceof AppError ? error.code : `unexpected: ${String(error)}`;
  }
  return 'no error';
};

describe('assignKycTier (back-office tier assignment)', () => {
  it('lets compliance upgrade a customer, audits the reason and notifies the customer', async () => {
    const customer = await createCustomer({ tier: 'TIER_0' });
    const officer = await createStaff('COMPLIANCE');

    const result = await assignKycTier(officer.ctx, customer.id, {
      tier: 'TIER_2',
      reason: 'Documents checked in branch',
    });
    expect(result).toMatchObject({ kycTier: 'TIER_2', kycStatus: 'VERIFIED' });

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'kyc.tier.assign', resourceId: customer.id },
    });
    expect(audit.actorId).toBe(officer.id);
    expect(audit.before).toMatchObject({ kycTier: 'TIER_0' });
    expect(audit.after).toMatchObject({
      kycTier: 'TIER_2',
      reason: 'Documents checked in branch',
    });
    const notification = await db.notification.findFirstOrThrow({
      where: { userId: customer.id, type: 'kyc.tier' },
    });
    expect(notification.href).toBe('/app/kyc');
  });

  it('withdraws the verified status when a customer is put back on tier 0', async () => {
    const customer = await createCustomer({ tier: 'TIER_1' });
    await db.user.update({ where: { id: customer.id }, data: { kycStatus: 'VERIFIED' } });
    const admin = await createStaff('ADMIN');
    const result = await assignKycTier(admin.ctx, customer.id, {
      tier: 'TIER_0',
      reason: 'Identity document expired',
    });
    expect(result).toMatchObject({ kycTier: 'TIER_0', kycStatus: 'NONE' });
  });

  it('is refused for roles without kyc:review and for the customer themselves', async () => {
    const customer = await createCustomer({ tier: 'TIER_0' });
    const input = { tier: 'TIER_2' as const, reason: 'Trying my luck' };
    for (const role of ['SUPPORT', 'TREASURY'] as const) {
      const staff = await createStaff(role);
      expect(await code(() => assignKycTier(staff.ctx, customer.id, input))).toBe('FORBIDDEN');
    }
    expect(await code(() => assignKycTier(customer.ctx, customer.id, input))).toBe('FORBIDDEN');
    const unchanged = await db.user.findUniqueOrThrow({ where: { id: customer.id } });
    expect(unchanged.kycTier).toBe('TIER_0');
    expect(await db.auditLog.count({ where: { action: 'kyc.tier.assign' } })).toBeLessThan(3);
  });

  it('validates the reason, the target account and no-op assignments', async () => {
    const customer = await createCustomer({ tier: 'TIER_1' });
    const officer = await createStaff('COMPLIANCE');
    await expect(
      assignKycTier(officer.ctx, customer.id, { tier: 'TIER_2', reason: 'no' }),
    ).rejects.toThrow();
    expect(
      await code(() =>
        assignKycTier(officer.ctx, customer.id, { tier: 'TIER_1', reason: 'Same tier again' }),
      ),
    ).toBe('INVALID_STATE');
    expect(
      await code(() =>
        assignKycTier(officer.ctx, officer.id, { tier: 'TIER_1', reason: 'Staff have no tier' }),
      ),
    ).toBe('INVALID_STATE');
    expect(
      await code(() =>
        assignKycTier(officer.ctx, '00000000-0000-4000-8000-000000000000', {
          tier: 'TIER_1',
          reason: 'Nobody home here',
        }),
      ),
    ).toBe('NOT_FOUND');
  });
});

describe('FX override reason', () => {
  it('stores the reason of a manual override in the audit row', async () => {
    const treasury = await createStaff('TREASURY');
    await setFxRate(treasury.ctx, {
      baseCurrency: 'XAF',
      quoteCurrency: 'AOA',
      midRate: '1.4321',
      marginBps: 210,
      reason: 'Aligning with the central bank fixing',
    });
    const rate = await db.fxRate.findUniqueOrThrow({
      where: { baseCurrency_quoteCurrency: { baseCurrency: 'XAF', quoteCurrency: 'AOA' } },
    });
    expect(rate.marginBps).toBe(210);
    expect(rate.source).toBe('manual');
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'fx_rate.override', resourceId: 'XAF/AOA' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.after).toMatchObject({
      marginBps: 210,
      reason: 'Aligning with the central bank fixing',
    });
  });

  it('is refused for compliance and support', async () => {
    for (const role of ['COMPLIANCE', 'SUPPORT'] as const) {
      const staff = await createStaff(role);
      expect(
        await code(() =>
          setFxRate(staff.ctx, {
            baseCurrency: 'XAF',
            quoteCurrency: 'MZN',
            midRate: '0.1',
            marginBps: 100,
            reason: 'Not my job at all',
          }),
        ),
      ).toBe('FORBIDDEN');
    }
  });
});

describe('statement comparison (pure)', () => {
  const line = (
    reference: string,
    direction: 'PAYOUT' | 'COLLECT',
    amount: bigint,
    status: ConnectorStatementLine['status'] = 'SUCCESS',
  ): ConnectorStatementLine => ({
    providerRef: `P-${reference}`,
    reference,
    direction,
    amount,
    currency: 'XAF',
    status,
    at: new Date('2026-11-01T10:00:00Z'),
  });

  it('nets payouts against collections and ignores unsuccessful lines', () => {
    const net = netStatement([
      line('A', 'PAYOUT', 5_000n),
      line('A', 'COLLECT', 5_000n),
      line('B', 'PAYOUT', 700n),
      line('C', 'COLLECT', 900n),
      line('D', 'PAYOUT', 1_000n, 'FAILED'),
      line('E', 'PAYOUT', 1_000n, 'PENDING'),
    ]);
    expect(Object.fromEntries(net)).toEqual({ A: 0n, B: 700n, C: -900n });
  });

  it('classifies matches and the three kinds of break', () => {
    const ledger = new Map([
      ['MATCH', { amount: 100n, transferId: 't1' }],
      ['REVERSED', { amount: 0n, transferId: 't2' }],
      ['MISMATCH', { amount: 100n, transferId: 't3' }],
      ['LEDGER', { amount: 250n, transferId: 't4' }],
    ]);
    const provider = new Map([
      ['MATCH', 100n],
      ['MISMATCH', 90n],
      ['PROVIDER', 40n],
      ['NETTED', 0n],
    ]);
    const { matched, breaks } = compareStatements(ledger, provider, 'XAF');
    expect(matched).toBe(2);
    expect(breaks.map((entry) => [entry.reference, entry.kind]).sort()).toEqual([
      ['LEDGER', 'LEDGER_ONLY'],
      ['MISMATCH', 'AMOUNT_MISMATCH'],
      ['PROVIDER', 'PROVIDER_ONLY'],
    ]);
    const mismatch = breaks.find((entry) => entry.reference === 'MISMATCH');
    expect(mismatch).toMatchObject({ ledgerAmount: 100n, providerAmount: 90n, transferId: 't3' });
  });
});

describe('getProviderReconciliation (ledger vs provider statements)', () => {
  it('reconciles payouts, top-ups and reversals, then reports a break when they diverge', async () => {
    const admin = await createStaff('ADMIN');
    const support = await createStaff('SUPPORT');
    const sender = await createCustomer({ balance: 900_000n, tier: 'TIER_2' });
    const mtn = await providerId('mtn-momo-cm');

    const payout = async (account: string, amount: bigint) =>
      (
        await createTransfer(sender.ctx, {
          senderWalletId: sender.walletId,
          recipient: { kind: 'MOBILE_MONEY', providerId: mtn, accountNumber: account, name: 'Rec' },
          amount,
          idempotencyKey: idem('recon'),
        })
      ).transfer;

    const completed = await payout('+237670001234', 40_000n);
    const failed = await payout('+237670000001', 10_000n);
    const pending = await payout('+237670000006', 15_000n);
    const toReverse = await payout('+237670005555', 20_000n);
    expect([completed.status, failed.status, pending.status, toReverse.status]).toEqual([
      'COMPLETED',
      'FAILED',
      'PROCESSING',
      'COMPLETED',
    ]);
    await reverseTransfer(admin.ctx, toReverse.id, 'Sent to the wrong number');
    const { transfer: topUp } = await topUpWallet(sender.ctx, {
      walletId: sender.walletId,
      providerId: mtn,
      accountNumber: '+237670009999',
      amount: 25_000n,
      idempotencyKey: idem('topup'),
    });
    expect(topUp.status).toBe('COMPLETED');

    // The period ends "now", so it is resolved after the movements exist.
    const range = resolveRange({ days: 1 });
    const [row] = (await getProviderReconciliation(support.ctx, range)).filter(
      (entry) => entry.providerId === mtn,
    );
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      code: 'mtn-momo-cm',
      simulated: true,
      statementSource: 'RECONSTRUCTED',
      statementError: null,
    });
    expect(row?.breaks).toEqual([]);
    // Float out for the completed payout, back in for the top-up; the reversal nets to zero.
    expect(row?.ledgerTotal).toBe(40_000n - 25_000n);
    expect(row?.providerTotal).toBe(row?.ledgerTotal);
    expect(row?.matched).toBe(3);

    // Simulate a divergence: the provider's acknowledgement of a settled payout goes missing.
    await db.transfer.update({ where: { id: completed.id }, data: { providerRef: null } });
    const [broken] = (await getProviderReconciliation(admin.ctx, range)).filter(
      (entry) => entry.providerId === mtn,
    );
    expect(broken?.breaks).toEqual([
      {
        reference: completed.reference,
        transferId: completed.id,
        currency: 'XAF',
        ledgerAmount: 40_000n,
        providerAmount: 0n,
        kind: 'LEDGER_ONLY',
      },
    ]);
  });

  it('requires transfers:read', async () => {
    const customer = await createCustomer();
    expect(
      await code(() => getProviderReconciliation(customer.ctx, resolveRange({ days: 1 }))),
    ).toBe('FORBIDDEN');
  });
});
