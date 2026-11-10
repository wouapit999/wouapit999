import { describe, expect, it } from 'vitest';

import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { verifyLedgerIntegrity } from '@/server/ledger';
import { setSetting } from '@/server/settings';
import { systemContext } from '@/server/rbac';
import {
  createTransfer,
  getTransferDetail,
  listMyTransfers,
  previewTransfer,
  quoteTransfer,
  reverseTransfer,
} from '@/server/transfers';

import { withTestDatabase } from '../helpers/db';
import {
  createCustomer,
  createPartner,
  createStaff,
  idem,
  systemBalance,
  walletBalance,
} from '../helpers/factories';

withTestDatabase();

const expectBalancedBooks = async (): Promise<void> => {
  const integrity = await verifyLedgerIntegrity();
  expect(integrity.length).toBeGreaterThan(0);
  for (const row of integrity) {
    expect(row, `ledger integrity for ${row.currency}`).toMatchObject({
      balanced: true,
      unbalancedJournals: 0,
      driftingAccounts: 0,
      negativeWallets: 0,
    });
    expect(row.totalDebits).toBe(row.totalCredits);
  }
};

describe('domestic transfers', () => {
  it('wallet → wallet moves money, charges the fee and keeps the ledger balanced', async () => {
    const sender = await createCustomer({ balance: 500_000n });
    const recipient = await createCustomer();
    const feesBefore = await systemBalance('FEE_REVENUE', 'XAF');

    const { transfer, replayed } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.phone },
      amount: 100_000n,
      idempotencyKey: idem(),
    });

    expect(replayed).toBe(false);
    expect(transfer.status).toBe('COMPLETED');
    expect(transfer.type).toBe('W2W');
    // Seeded W2W rule: 50 bps → 500 XAF.
    expect(transfer.feeAmount).toBe(500n);
    expect(transfer.totalDebit).toBe(100_500n);
    expect(await walletBalance(sender.walletId)).toBe(399_500n);
    expect(await walletBalance(recipient.walletId)).toBe(100_000n);
    expect((await systemBalance('FEE_REVENUE', 'XAF')) - feesBefore).toBe(500n);
    await expectBalancedBooks();

    const events = await db.transferEvent.findMany({
      where: { transferId: transfer.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(events.map((event) => event.type).sort()).toEqual(['COMPLETED', 'CREATED', 'SCREENED']);

    // One balanced journal: DR sender 100 500 = CR recipient 100 000 + CR fees 500.
    const journals = await db.journal.findMany({
      where: { transferId: transfer.id },
      include: { entries: true },
    });
    expect(journals).toHaveLength(1);
    const debits = journals[0]!.entries
      .filter((entry) => entry.direction === 'DEBIT')
      .reduce((sum, entry) => sum + entry.amount, 0n);
    const credits = journals[0]!.entries
      .filter((entry) => entry.direction === 'CREDIT')
      .reduce((sum, entry) => sum + entry.amount, 0n);
    expect(debits).toBe(100_500n);
    expect(credits).toBe(100_500n);

    // Audit trail and notifications for both parties.
    const audit = await db.auditLog.findFirst({
      where: { action: 'transfer.create', resourceId: transfer.id },
    });
    expect(audit?.actorId).toBe(sender.id);
    expect(
      await db.notification.count({ where: { userId: recipient.id, type: 'transfer.received' } }),
    ).toBe(1);
    expect(
      await db.notification.count({ where: { userId: sender.id, type: 'transfer.completed' } }),
    ).toBe(1);
  });

  it('wallet → merchant accrues the partner commission in the same transaction', async () => {
    const sender = await createCustomer({ balance: 1_000_000n });
    const merchant = await createPartner({ type: 'MERCHANT', commissionBps: 30 });

    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: merchant.code },
      amount: 200_000n,
      idempotencyKey: idem(),
    });

    expect(transfer.type).toBe('W2M');
    expect(transfer.status).toBe('COMPLETED');
    expect(transfer.feeAmount).toBe(1_500n); // 75 bps
    expect(transfer.partnerId).toBe(merchant.id);
    expect(transfer.commissionAmount).toBe(600n); // 30 bps of 200 000
    expect(await walletBalance(merchant.walletId)).toBe(200_000n);
    const commission = await db.commission.findFirstOrThrow({ where: { transferId: transfer.id } });
    expect(commission).toMatchObject({
      partnerId: merchant.id,
      amount: 600n,
      status: 'ACCRUED',
      currency: 'XAF',
    });
    const journals = await db.journal.findMany({ where: { transferId: transfer.id } });
    expect(journals.map((journal) => journal.kind).sort()).toEqual(['COMMISSION', 'TRANSFER']);
    await expectBalancedBooks();
  });

  it('wallet → agent is classified W2A with the cash-out fee', async () => {
    const sender = await createCustomer({ balance: 300_000n });
    const agent = await createPartner({ type: 'AGENT', commissionBps: 40 });
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: agent.code },
      amount: 100_000n,
      idempotencyKey: idem(),
    });
    expect(transfer.type).toBe('W2A');
    expect(transfer.feeAmount).toBe(1_500n); // 150 bps
    expect(transfer.commissionAmount).toBe(400n);
  });

  it('caps the commission at the fee collected', async () => {
    const sender = await createCustomer({ balance: 1_000_000n });
    const merchant = await createPartner({ type: 'MERCHANT', commissionBps: 900 });
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: merchant.code },
      amount: 100_000n,
      idempotencyKey: idem(),
    });
    expect(transfer.feeAmount).toBe(750n);
    expect(transfer.commissionAmount).toBe(750n);
  });

  it('rejects an overdraft and leaves no trace', async () => {
    const sender = await createCustomer({ balance: 10_000n });
    const recipient = await createCustomer();
    const key = idem();
    await expect(
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: { kind: 'WALLET', identifier: recipient.email },
        amount: 10_000n, // + 50 fee > balance
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(await walletBalance(sender.walletId)).toBe(10_000n);
    expect(await db.transfer.count({ where: { idempotencyKey: key } })).toBe(0);
  });
});

describe('authorisation (rule 8)', () => {
  it("does not let a customer send from someone else's wallet", async () => {
    const victim = await createCustomer({ balance: 500_000n });
    const attacker = await createCustomer();
    await expect(
      createTransfer(attacker.ctx, {
        senderWalletId: victim.walletId,
        recipient: { kind: 'WALLET', identifier: attacker.phone },
        amount: 100_000n,
        idempotencyKey: idem(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await walletBalance(victim.walletId)).toBe(500_000n);
  });

  it('hides transfers from strangers and redacts the recipient view', async () => {
    const sender = await createCustomer({ balance: 500_000n });
    const recipient = await createCustomer();
    const stranger = await createCustomer();
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.phone },
      amount: 50_000n,
      idempotencyKey: idem(),
      note: 'private note',
    });
    await expect(getTransferDetail(stranger.ctx, transfer.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(getTransferDetail(stranger.ctx, transfer.reference)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const asRecipient = await getTransferDetail(recipient.ctx, transfer.id);
    expect(asRecipient.perspective).toBe('RECIPIENT');
    expect(asRecipient.transfer.idempotencyKey).toBe('');
    expect(asRecipient.events.every((event) => event.data === null)).toBe(true);

    const asSender = await getTransferDetail(sender.ctx, transfer.reference);
    expect(asSender.perspective).toBe('SENDER');
    expect(asSender.transfer.note).toBe('private note');

    const strangerHistory = await listMyTransfers(stranger.ctx);
    expect(strangerHistory.total).toBe(0);
    const recipientHistory = await listMyTransfers(recipient.ctx);
    expect(recipientHistory.items.map((item) => item.direction)).toEqual(['received']);
  });

  it('requires transfers:reverse to reverse', async () => {
    const sender = await createCustomer({ balance: 500_000n });
    const recipient = await createCustomer();
    const support = await createStaff('SUPPORT');
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.phone },
      amount: 50_000n,
      idempotencyKey: idem(),
    });
    await expect(
      reverseTransfer(sender.ctx, transfer.id, 'I changed my mind'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      reverseTransfer(support.ctx, transfer.id, 'Support cannot do this'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('idempotency (rule 4)', () => {
  it('returns the original transfer on replay and debits once', async () => {
    const sender = await createCustomer({ balance: 500_000n });
    const recipient = await createCustomer();
    const input = {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET' as const, identifier: recipient.phone },
      amount: 100_000n,
      idempotencyKey: idem(),
    };
    const first = await createTransfer(sender.ctx, input);
    const second = await createTransfer(sender.ctx, input);
    expect(second.replayed).toBe(true);
    expect(second.transfer.id).toBe(first.transfer.id);
    expect(await walletBalance(sender.walletId)).toBe(399_500n);
    expect(await walletBalance(recipient.walletId)).toBe(100_000n);
  });

  it('debits once when the same key is submitted concurrently', async () => {
    const sender = await createCustomer({ balance: 500_000n });
    const recipient = await createCustomer();
    const input = {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET' as const, identifier: recipient.phone },
      amount: 100_000n,
      idempotencyKey: idem(),
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => createTransfer(sender.ctx, input)),
    );
    expect(new Set(results.map((result) => result.transfer.id)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(await walletBalance(sender.walletId)).toBe(399_500n);
    expect(await db.transfer.count({ where: { idempotencyKey: input.idempotencyKey } })).toBe(1);
  });

  it('scopes keys per sender', async () => {
    const a = await createCustomer({ balance: 100_000n });
    const b = await createCustomer({ balance: 100_000n });
    const key = idem();
    const first = await createTransfer(a.ctx, {
      senderWalletId: a.walletId,
      recipient: { kind: 'WALLET', identifier: b.phone },
      amount: 10_000n,
      idempotencyKey: key,
    });
    const second = await createTransfer(b.ctx, {
      senderWalletId: b.walletId,
      recipient: { kind: 'WALLET', identifier: a.phone },
      amount: 10_000n,
      idempotencyKey: key,
    });
    expect(second.replayed).toBe(false);
    expect(second.transfer.id).not.toBe(first.transfer.id);
  });
});

describe('concurrency (rules 1 and 3)', () => {
  it('never lets a wallet go negative when parallel transfers race', async () => {
    // 20 transfers of 10 000 (+60 fee) against 100 000: exactly 9 can succeed.
    const sender = await createCustomer({ balance: 100_000n });
    const recipients = await Promise.all(Array.from({ length: 4 }, () => createCustomer()));
    const attempts = Array.from({ length: 20 }, (_, index) =>
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: { kind: 'WALLET', identifier: recipients[index % recipients.length]!.phone },
        amount: 10_000n,
        idempotencyKey: idem('race'),
      }).then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    );
    const outcomes = await Promise.all(attempts);
    const succeeded = outcomes.filter((outcome) => outcome.ok);
    const failed = outcomes.filter((outcome) => !outcome.ok);

    expect(succeeded).toHaveLength(9);
    expect(failed).toHaveLength(11);
    for (const outcome of failed) {
      expect(outcome.error).toBeInstanceOf(AppError);
      expect((outcome.error as AppError).code).toBe('INSUFFICIENT_FUNDS');
    }
    // 50 bps of 10 000 is 50 XAF, below the 60 XAF minimum fee → each transfer costs 10 060.
    const balance = await walletBalance(sender.walletId);
    expect(balance).toBe(100_000n - 9n * 10_060n);
    expect(balance >= 0n).toBe(true);
    const received = await Promise.all(
      recipients.map((recipient) => walletBalance(recipient.walletId)),
    );
    expect(received.reduce((sum, value) => sum + value, 0n)).toBe(90_000n);
    await expectBalancedBooks();
  });

  it('survives opposing transfers between two wallets without deadlocking', async () => {
    const a = await createCustomer({ balance: 1_000_000n });
    const b = await createCustomer({ balance: 1_000_000n });
    const jobs = Array.from({ length: 16 }, (_, index) => {
      const [from, to] = index % 2 === 0 ? [a, b] : [b, a];
      return createTransfer(from.ctx, {
        senderWalletId: from.walletId,
        recipient: { kind: 'WALLET', identifier: to.phone },
        amount: 5_000n,
        idempotencyKey: idem('cross'),
      });
    });
    const results = await Promise.all(jobs);
    expect(results.every((result) => result.transfer.status === 'COMPLETED')).toBe(true);
    // 8 each way: the principal nets to zero, each side pays 8 fees (the 60 XAF minimum).
    const fee = results[0]!.transfer.feeAmount;
    expect(await walletBalance(a.walletId)).toBe(1_000_000n - 8n * fee);
    expect(await walletBalance(b.walletId)).toBe(1_000_000n - 8n * fee);
    await expectBalancedBooks();
  });
});

describe('international transfers (rule 2)', () => {
  it('XAF → AOA is exact to the minor unit: rate, margin and fee', async () => {
    const sender = await createCustomer({ country: 'CM', balance: 2_000_000n });
    const recipient = await createCustomer({ country: 'AO' });
    const before = {
      feeRevenue: await systemBalance('FEE_REVENUE', 'XAF'),
      fxRevenue: await systemBalance('FX_REVENUE', 'XAF'),
      positionXaf: await systemBalance('FX_POSITION', 'XAF'),
      positionAoa: await systemBalance('FX_POSITION', 'AOA'),
    };

    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.email },
      amount: 250_000n,
      idempotencyKey: idem(),
      purpose: 'FAMILY_SUPPORT',
      sourceOfFunds: 'SALARY',
    });

    // Expected values computed by hand from the seed:
    //   mid = 985 / 655.957 = 1.5016228198 AOA per XAF (10 decimals, half up)
    //   margin 175 bps → customer rate = floor(mid × 0.9825) = 1.4753444204
    //   receive = floor(250 000 × 1.4753444204 × 100) = 36 883 610 (AOA cents) = 368 836.10 AOA
    //   fx margin = round(250 000 × 0.0175) = 4 375 XAF
    //   fee = 600 fixed + 150 bps × 250 000 = 4 350 XAF
    expect(transfer.type).toBe('INTERNATIONAL');
    expect(transfer.status).toBe('COMPLETED');
    expect(transfer.midRate.toFixed(10)).toBe('1.5016228198');
    expect(transfer.customerRate.toFixed(10)).toBe('1.4753444204');
    expect(transfer.marginBps).toBe(175);
    expect(transfer.sendAmount).toBe(250_000n);
    expect(transfer.fxMarginAmount).toBe(4_375n);
    expect(transfer.feeAmount).toBe(4_350n);
    expect(transfer.totalDebit).toBe(254_350n);
    expect(transfer.receiveAmount).toBe(36_883_610n);

    expect(await walletBalance(sender.walletId)).toBe(2_000_000n - 254_350n);
    expect(await walletBalance(recipient.walletId)).toBe(36_883_610n);
    expect((await systemBalance('FEE_REVENUE', 'XAF')) - before.feeRevenue).toBe(4_350n);
    expect((await systemBalance('FX_REVENUE', 'XAF')) - before.fxRevenue).toBe(4_375n);
    // Long 245 625 XAF, short 368 836.10 AOA.
    expect((await systemBalance('FX_POSITION', 'XAF')) - before.positionXaf).toBe(245_625n);
    expect((await systemBalance('FX_POSITION', 'AOA')) - before.positionAoa).toBe(-36_883_610n);

    // Two balanced legs in one journal: XAF debits = credits, AOA debits = credits.
    const entries = await db.ledgerEntry.findMany({
      where: { journal: { transferId: transfer.id } },
    });
    for (const currency of ['XAF', 'AOA']) {
      const sum = (direction: 'DEBIT' | 'CREDIT') =>
        entries
          .filter((entry) => entry.currency === currency && entry.direction === direction)
          .reduce((total, entry) => total + entry.amount, 0n);
      expect(sum('DEBIT')).toBe(sum('CREDIT'));
      expect(sum('DEBIT')).toBeGreaterThan(0n);
    }
    await expectBalancedBooks();
  });

  it('AOA → XAF (2-decimal into 0-decimal currency) floors the payout', async () => {
    const sender = await createCustomer({ country: 'AO', balance: 100_000_00n });
    const recipient = await createCustomer({ country: 'CM' });
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.phone },
      amount: 12_345_67n, // 12 345.67 AOA
      idempotencyKey: idem(),
      purpose: 'GIFT',
      sourceOfFunds: 'SAVINGS',
    });
    //   mid = 655.957 / 985 = 0.6659461929; customer = floor(mid × 0.9825) = 0.6542921345
    //   receive = floor(1 234 567 × 0.6542921345 / 100) = floor(8 077.67…) = 8 077 XAF
    //   fx margin = round(1 234 567 × 0.0175) = 21 605 (216.05 AOA)
    //   fee = 90 000 fixed (900.00 AOA) + round(1 234 567 × 0.015) = 90 000 + 18 519 = 108 519
    expect(transfer.midRate.toFixed(10)).toBe('0.6659461929');
    expect(transfer.customerRate.toFixed(10)).toBe('0.6542921345');
    expect(transfer.receiveAmount).toBe(8_077n);
    expect(transfer.fxMarginAmount).toBe(21_605n);
    expect(transfer.feeAmount).toBe(108_519n);
    expect(transfer.totalDebit).toBe(1_343_086n);
    expect(await walletBalance(recipient.walletId)).toBe(8_077n);
    await expectBalancedBooks();
  });

  it('same-currency cross-border (CM → GA) is international without FX', async () => {
    const sender = await createCustomer({ country: 'CM', balance: 500_000n });
    const recipient = await createCustomer({ country: 'GA' });
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.phone },
      amount: 100_000n,
      idempotencyKey: idem(),
      purpose: 'FAMILY_SUPPORT',
      sourceOfFunds: 'SALARY',
    });
    expect(transfer.type).toBe('INTERNATIONAL');
    expect(transfer.fxMarginAmount).toBe(0n);
    expect(transfer.receiveAmount).toBe(100_000n);
    expect(transfer.feeAmount).toBe(2_100n); // 600 + 150 bps
  });

  it('requires purpose and source of funds', async () => {
    const sender = await createCustomer({ country: 'CM', balance: 500_000n });
    const recipient = await createCustomer({ country: 'AO' });
    await expect(
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: { kind: 'WALLET', identifier: recipient.email },
        amount: 100_000n,
        idempotencyKey: idem(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('honours a locked quote after the market rate moves, and expires it', async () => {
    const sender = await createCustomer({ country: 'CM', balance: 2_000_000n });
    const recipient = await createCustomer({ country: 'MZ' });
    const request = {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET' as const, identifier: recipient.email },
      amount: 100_000n,
    };
    const quoted = await quoteTransfer(sender.ctx, request);
    expect(quoted.quoteId).not.toBeNull();
    expect(quoted.expiresAt!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(quoted.expiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);

    // Treasury doubles the rate after the quote was issued.
    const { setFxRate } = await import('@/server/fx');
    await setFxRate(systemContext('test'), {
      baseCurrency: 'XAF',
      quoteCurrency: 'MZN',
      midRate: '0.25',
      marginBps: 100,
    });
    const fresh = await previewTransfer(sender.ctx, request);
    expect(fresh.pricing.receiveAmount).not.toBe(quoted.pricing.receiveAmount);

    const { transfer } = await createTransfer(sender.ctx, {
      ...request,
      quoteId: quoted.quoteId!,
      idempotencyKey: idem(),
      purpose: 'EDUCATION',
      sourceOfFunds: 'SALARY',
    });
    expect(transfer.receiveAmount).toBe(quoted.pricing.receiveAmount);
    expect(transfer.customerRate.toFixed(10)).toBe(
      (await db.quote.findUniqueOrThrow({ where: { id: quoted.quoteId! } })).customerRate.toFixed(
        10,
      ),
    );

    // A quote can be used once…
    await expect(
      createTransfer(sender.ctx, {
        ...request,
        quoteId: quoted.quoteId!,
        idempotencyKey: idem(),
        purpose: 'EDUCATION',
        sourceOfFunds: 'SALARY',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // …and not after it expires (clock moved 16 minutes ahead).
    const second = await quoteTransfer(sender.ctx, request);
    await expect(
      createTransfer(
        sender.ctx,
        {
          ...request,
          quoteId: second.quoteId!,
          idempotencyKey: idem(),
          purpose: 'EDUCATION',
          sourceOfFunds: 'SALARY',
        },
        { now: new Date(Date.now() + 16 * 60_000) },
      ),
    ).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });

    // Someone else's quote is not usable.
    const other = await createCustomer({ country: 'CM', balance: 500_000n });
    const third = await quoteTransfer(sender.ctx, request);
    await expect(
      createTransfer(other.ctx, {
        senderWalletId: other.walletId,
        recipient: request.recipient,
        quoteId: third.quoteId!,
        idempotencyKey: idem(),
        purpose: 'EDUCATION',
        sourceOfFunds: 'SALARY',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('limits per KYC tier', () => {
  it('tier 0 cannot send abroad and is capped at about USD 50 per transfer', async () => {
    const sender = await createCustomer({ tier: 'TIER_0', balance: 500_000n });
    const local = await createCustomer();
    const abroad = await createCustomer({ country: 'AO' });

    await expect(
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: { kind: 'WALLET', identifier: abroad.email },
        amount: 5_000n,
        idempotencyKey: idem(),
        purpose: 'GIFT',
        sourceOfFunds: 'SAVINGS',
      }),
    ).rejects.toMatchObject({ code: 'KYC_REQUIRED' });

    // 607.3676 XAF per USD → 30 000 XAF ≈ USD 49.39 passes, 31 000 XAF ≈ USD 51.04 does not.
    const ok = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: local.phone },
      amount: 30_000n,
      idempotencyKey: idem(),
    });
    expect(ok.transfer.status).toBe('COMPLETED');
    expect(ok.transfer.sendAmountUsd).toBe(4_939n);
    await expect(
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: { kind: 'WALLET', identifier: local.phone },
        amount: 31_000n,
        idempotencyKey: idem(),
      }),
    ).rejects.toMatchObject({ code: 'KYC_REQUIRED' });
  });

  it('enforces the daily limit across transfers (tier 0: USD 100)', async () => {
    const sender = await createCustomer({ tier: 'TIER_0', balance: 500_000n });
    const recipient = await createCustomer();
    const send = (amount: bigint) =>
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: { kind: 'WALLET', identifier: recipient.phone },
        amount,
        idempotencyKey: idem(),
      });
    await send(30_000n); // USD 49.39
    await send(30_000n); // USD 98.78 in total
    await expect(send(1_000n)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' }); // + USD 1.65 > 100
    await send(700n); // + USD 1.15 = 99.93, still inside
  });

  it('tier 1 may send abroad up to about USD 1 000; tier 2 goes higher', async () => {
    const tier1 = await createCustomer({ tier: 'TIER_1', balance: 5_000_000n });
    const tier2 = await createCustomer({ tier: 'TIER_2', balance: 5_000_000n });
    const abroad = await createCustomer({ country: 'AO' });
    const send = (customer: typeof tier1, amount: bigint) =>
      createTransfer(customer.ctx, {
        senderWalletId: customer.walletId,
        recipient: { kind: 'WALLET', identifier: abroad.email },
        amount,
        idempotencyKey: idem(),
        purpose: 'FAMILY_SUPPORT',
        sourceOfFunds: 'SALARY',
      });
    expect((await send(tier1, 600_000n)).transfer.status).toBe('COMPLETED'); // ≈ USD 988
    await expect(send(tier1, 620_000n)).rejects.toMatchObject({ code: 'KYC_REQUIRED' }); // ≈ USD 1 021
    expect((await send(tier2, 620_000n)).transfer.status).toBe('COMPLETED');
  });

  it('follows the limits configured in settings', async () => {
    const admin = await createStaff('ADMIN');
    const sender = await createCustomer({ tier: 'TIER_0', balance: 500_000n });
    const recipient = await createCustomer();
    await setSetting(admin.ctx, 'kyc.limits', {
      TIER_0: { perTransaction: '1000', daily: '10000', monthly: '30000', international: false },
      TIER_1: {
        perTransaction: '100000',
        daily: '250000',
        monthly: '1000000',
        international: true,
      },
      TIER_2: {
        perTransaction: '1000000',
        daily: '2500000',
        monthly: '10000000',
        international: true,
      },
    });
    await expect(
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: { kind: 'WALLET', identifier: recipient.phone },
        amount: 10_000n, // ≈ USD 16.46 > USD 10
        idempotencyKey: idem(),
      }),
    ).rejects.toMatchObject({ code: 'KYC_REQUIRED' });
    await setSetting(admin.ctx, 'kyc.limits', {
      TIER_0: { perTransaction: '5000', daily: '10000', monthly: '30000', international: false },
      TIER_1: {
        perTransaction: '100000',
        daily: '250000',
        monthly: '1000000',
        international: true,
      },
      TIER_2: {
        perTransaction: '1000000',
        daily: '2500000',
        monthly: '10000000',
        international: true,
      },
    });
  });
});

describe('reversal (rule 7)', () => {
  it('posts compensating journals and never edits the originals', async () => {
    const admin = await createStaff('ADMIN');
    const sender = await createCustomer({ balance: 500_000n });
    const merchant = await createPartner({ type: 'MERCHANT', commissionBps: 30 });
    const feesBefore = await systemBalance('FEE_REVENUE', 'XAF');
    const payableBefore = await systemBalance('COMMISSION_PAYABLE', 'XAF');

    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: merchant.code },
      amount: 100_000n,
      idempotencyKey: idem(),
    });
    const originals = await db.journal.findMany({
      where: { transferId: transfer.id },
      include: { entries: true },
    });

    const reversed = await reverseTransfer(
      admin.ctx,
      transfer.id,
      'Customer paid the wrong merchant',
    );
    expect(reversed.status).toBe('REVERSED');
    expect(reversed.reversedAt).not.toBeNull();

    // Everyone is back where they started.
    expect(await walletBalance(sender.walletId)).toBe(500_000n);
    expect(await walletBalance(merchant.walletId)).toBe(0n);
    expect(await systemBalance('FEE_REVENUE', 'XAF')).toBe(feesBefore);
    expect(await systemBalance('COMMISSION_PAYABLE', 'XAF')).toBe(payableBefore);
    expect(
      (await db.commission.findFirstOrThrow({ where: { transferId: transfer.id } })).status,
    ).toBe('REVERSED');

    // Originals untouched, mirrored one-to-one by REVERSAL journals.
    const after = await db.journal.findMany({
      where: { transferId: transfer.id },
      include: { entries: true },
    });
    expect(after).toHaveLength(originals.length * 2);
    for (const original of originals) {
      const same = after.find((journal) => journal.id === original.id)!;
      expect(same.entries).toEqual(original.entries);
      const mirror = after.find((journal) => journal.reversesJournalId === original.id)!;
      expect(mirror.kind).toBe('REVERSAL');
      expect(mirror.entries).toHaveLength(original.entries.length);
    }
    await expectBalancedBooks();

    await expect(reverseTransfer(admin.ctx, transfer.id, 'Trying it twice')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(
      await db.auditLog.count({
        where: { action: 'transfer.reverse', resourceId: transfer.id, outcome: 'SUCCESS' },
      }),
    ).toBe(1);
  });

  it('refuses when the recipient has already spent the money', async () => {
    const admin = await createStaff('ADMIN');
    const sender = await createCustomer({ balance: 500_000n });
    const recipient = await createCustomer();
    const third = await createCustomer();
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.phone },
      amount: 100_000n,
      idempotencyKey: idem(),
    });
    await createTransfer(recipient.ctx, {
      senderWalletId: recipient.walletId,
      recipient: { kind: 'WALLET', identifier: third.phone },
      amount: 90_000n,
      idempotencyKey: idem(),
    });
    await expect(
      reverseTransfer(admin.ctx, transfer.id, 'Fraud report from the sender'),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect((await db.transfer.findUniqueOrThrow({ where: { id: transfer.id } })).status).toBe(
      'COMPLETED',
    );
    expect(await walletBalance(sender.walletId)).toBe(399_500n);
    await expectBalancedBooks();
  });
});

describe('database guards', () => {
  it('rejects edits and deletes of journals, entries, events and audit rows', async () => {
    const sender = await createCustomer({ balance: 100_000n });
    const recipient = await createCustomer();
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.phone },
      amount: 10_000n,
      idempotencyKey: idem(),
    });
    await expect(
      db.ledgerEntry.updateMany({
        where: { journal: { transferId: transfer.id } },
        data: { amount: 1n },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.ledgerEntry.deleteMany({ where: { journal: { transferId: transfer.id } } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.journal.updateMany({
        where: { transferId: transfer.id },
        data: { description: 'tampered' },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.transferEvent.deleteMany({ where: { transferId: transfer.id } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.auditLog.updateMany({ where: { resourceId: transfer.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.auditLog.deleteMany({ where: { resourceId: transfer.id } })).rejects.toThrow(
      /append-only/,
    );
  });

  it('rejects an unbalanced journal and a negative wallet at the database level', async () => {
    const customer = await createCustomer({ balance: 1_000n });
    const journal = await db.journal.create({
      data: { kind: 'ADJUSTMENT', description: 'unbalanced' },
    });
    await expect(
      db.ledgerEntry.create({
        data: {
          journalId: journal.id,
          accountId: customer.ledgerAccountId,
          direction: 'CREDIT',
          amount: 5n,
          currency: 'XAF',
          balanceAfter: 5n,
        },
      }),
    ).rejects.toThrow(/not balanced/);
    await expect(
      db.ledgerAccount.update({ where: { id: customer.ledgerAccountId }, data: { balance: -1n } }),
    ).rejects.toThrow(/ledger_accounts_balance_non_negative|check constraint/i);
  });
});
