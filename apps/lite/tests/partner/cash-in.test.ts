import { describe, expect, it } from 'vitest';

import { executeCashIn, planCashIn } from '@/app/partner/_lib/cash-in';
import { db } from '@/server/db';
import { verifyLedgerIntegrity } from '@/server/ledger';
import { getPartnerDashboard, updatePartner } from '@/server/partners';
import { createTransfer, getTransferDetail, listMyTransfers } from '@/server/transfers';

import { withTestDatabase } from '../helpers/db';
import {
  createCustomer,
  createPartner,
  createStaff,
  idem,
  walletBalance,
} from '../helpers/factories';

withTestDatabase();

const key = (): string => `cashin-${crypto.randomUUID()}`;

describe('agent cash-in', () => {
  it('previews the customer and the cost without moving money', async () => {
    const agent = await createPartner({ type: 'AGENT', balance: 100_000n });
    const customer = await createCustomer({ fullName: 'Brigitte Cash' });
    const plan = await planCashIn(agent.ctx, { customer: customer.phone, amount: '10 000' });
    expect(plan.amount).toBe(10_000n);
    expect(plan.preview.plan.recipient.name).toBe('Brigitte Cash');
    expect(plan.preview.pricing.totalDebit).toBe(10_000n + plan.preview.pricing.feeAmount);
    expect(await walletBalance(agent.walletId)).toBe(100_000n);
    expect(await walletBalance(customer.walletId)).toBe(0n);
  });

  it('credits the customer from the float through the transfer engine, exactly once', async () => {
    const agent = await createPartner({ type: 'AGENT', balance: 100_000n, commissionBps: 40 });
    const customer = await createCustomer();
    const idempotencyKey = key();
    const input = { customer: customer.email, amount: '25000', idempotencyKey };

    const first = await executeCashIn(agent.ctx, input);
    expect(first.replayed).toBe(false);
    expect(first.transfer).toMatchObject({
      status: 'COMPLETED',
      type: 'W2W',
      senderPartnerId: agent.id,
      recipientUserId: customer.id,
      sendAmount: 25_000n,
      receiveAmount: 25_000n,
    });
    expect(await walletBalance(customer.walletId)).toBe(25_000n);
    expect(await walletBalance(agent.walletId)).toBe(100_000n - first.transfer.totalDebit);

    // A double click / retry with the same key returns the first transfer and moves nothing.
    const second = await executeCashIn(agent.ctx, input);
    expect(second.replayed).toBe(true);
    expect(second.transfer.id).toBe(first.transfer.id);
    expect(await walletBalance(customer.walletId)).toBe(25_000n);
    expect(await walletBalance(agent.walletId)).toBe(100_000n - first.transfer.totalDebit);

    // One balanced journal, an audit row, and commission accrued in the same transaction.
    expect(await db.journal.count({ where: { transferId: first.transfer.id } })).toBeGreaterThan(0);
    expect(
      await db.auditLog.count({
        where: { resourceType: 'transfer', resourceId: first.transfer.id },
      }),
    ).toBeGreaterThan(0);
    const integrity = await verifyLedgerIntegrity();
    expect(integrity.every((row) => row.balanced)).toBe(true);
  });

  it('never lets the float go negative', async () => {
    const agent = await createPartner({ type: 'AGENT', balance: 5_000n });
    const customer = await createCustomer();
    await expect(
      executeCashIn(agent.ctx, { customer: customer.phone, amount: '5000', idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(await walletBalance(agent.walletId)).toBe(5_000n);
    expect(await walletBalance(customer.walletId)).toBe(0n);
  });

  it('is refused for merchants, API partners and suspended agents', async () => {
    const admin = await createStaff('ADMIN');
    const customer = await createCustomer();
    const input = { customer: customer.phone, amount: '1000' };
    for (const type of ['MERCHANT', 'PARTNER'] as const) {
      const partner = await createPartner({ type, balance: 50_000n });
      await expect(planCashIn(partner.ctx, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        executeCashIn(partner.ctx, { ...input, idempotencyKey: key() }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await walletBalance(partner.walletId)).toBe(50_000n);
    }
    const agent = await createPartner({ type: 'AGENT', balance: 50_000n });
    await updatePartner(admin.ctx, agent.id, { status: 'SUSPENDED' });
    await expect(planCashIn(agent.ctx, input)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    // A customer has no partner at all.
    await expect(planCashIn(customer.ctx, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await walletBalance(customer.walletId)).toBe(0n);
  });

  it('only credits customers of the same country and currency', async () => {
    const agent = await createPartner({ type: 'AGENT', balance: 80_000n });
    const abroad = await createCustomer({ country: 'AO' });
    const merchant = await createPartner({ type: 'MERCHANT' });
    await expect(
      planCashIn(agent.ctx, { customer: abroad.email, amount: '1000' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(
      planCashIn(agent.ctx, { customer: merchant.code, amount: '1000' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      planCashIn(agent.ctx, { customer: 'nobody@nowhere.test', amount: '1000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await walletBalance(agent.walletId)).toBe(80_000n);
  });

  it.each(['', 'abc', '-50', '0', '12.5'])('rejects the amount %j', async (amount) => {
    const agent = await createPartner({ type: 'AGENT', balance: 10_000n });
    const customer = await createCustomer();
    await expect(planCashIn(agent.ctx, { customer: customer.phone, amount })).rejects.toMatchObject(
      {
        code: 'VALIDATION',
      },
    );
  });

  it('rejects an idempotency key that was not minted by the preview', async () => {
    const agent = await createPartner({ type: 'AGENT', balance: 10_000n });
    const customer = await createCustomer();
    await expect(
      executeCashIn(agent.ctx, { customer: customer.phone, amount: '1000', idempotencyKey: 'x' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await walletBalance(agent.walletId)).toBe(10_000n);
  });
});

describe('partner portal reads', () => {
  it('shows a cash-out (customer → agent code) to the agent, and only to that agent', async () => {
    const agent = await createPartner({ type: 'AGENT' });
    const otherAgent = await createPartner({ type: 'AGENT' });
    const customer = await createCustomer({ balance: 60_000n });
    const { transfer } = await createTransfer(customer.ctx, {
      senderWalletId: customer.walletId,
      recipient: { kind: 'WALLET', identifier: agent.code },
      amount: 15_000n,
      idempotencyKey: idem('cashout'),
    });
    expect(transfer.type).toBe('W2A');

    const detail = await getTransferDetail(agent.ctx, transfer.reference);
    expect(detail.perspective).toBe('RECIPIENT');
    expect(detail.transfer.receiveAmount).toBe(15_000n);
    await expect(getTransferDetail(otherAgent.ctx, transfer.reference)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    // Regression: payments from customers (no sender partner) must appear in the partner's list.
    const mine = await listMyTransfers(agent.ctx, { direction: 'received' });
    expect(mine.items.map((item) => item.reference)).toEqual([transfer.reference]);
    expect(mine.items[0]).toMatchObject({ direction: 'received', amount: 15_000n, feeAmount: 0n });
    expect((await listMyTransfers(otherAgent.ctx)).total).toBe(0);
    // …and symmetrically an API payout (no sender user) appears in the customer's history.
    const partner = await createPartner({ type: 'PARTNER', balance: 40_000n });
    const payout = await createTransfer(partner.ctx, {
      senderWalletId: partner.walletId,
      recipient: { kind: 'WALLET', identifier: customer.phone },
      amount: 4_000n,
      idempotencyKey: idem('payout'),
    });
    const customerReceived = await listMyTransfers(customer.ctx, { direction: 'received' });
    expect(customerReceived.items.map((item) => item.reference)).toEqual([
      payout.transfer.reference,
    ]);
  });

  it('builds the dashboard from the partner’s own figures', async () => {
    const merchant = await createPartner({ type: 'MERCHANT', commissionBps: 50 });
    const other = await createPartner({ type: 'MERCHANT', commissionBps: 50 });
    const customer = await createCustomer({ balance: 100_000n });
    for (const [target, amount] of [
      [merchant, 20_000n],
      [merchant, 10_000n],
      [other, 7_000n],
    ] as const) {
      await createTransfer(customer.ctx, {
        senderWalletId: customer.walletId,
        recipient: { kind: 'WALLET', identifier: target.code },
        amount,
        idempotencyKey: idem('buy'),
      });
    }
    const dashboard = await getPartnerDashboard(merchant.ctx);
    expect(dashboard.wallets).toEqual([
      expect.objectContaining({ currency: 'XAF', balance: 30_000n }),
    ]);
    expect(dashboard.last30Days.received).toEqual([{ currency: 'XAF', count: 2, amount: 30_000n }]);
    expect(dashboard.commissions).toEqual([
      expect.objectContaining({ currency: 'XAF', accrued: 150n, accruedCount: 2, settled: 0n }),
    ]);
    // A partner can never ask for another partner's dashboard.
    await expect(getPartnerDashboard(merchant.ctx, other.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
