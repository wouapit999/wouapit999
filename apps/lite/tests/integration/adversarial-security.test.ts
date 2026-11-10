import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  beginMfaEnrolment,
  confirmMfaEnrolment,
  login,
  registerCustomer,
  totpCode,
} from '@/server/auth';
import { rotateWebhookSecret } from '@/server/connectors/providers';
import { handleProviderWebhook } from '@/server/connectors/webhooks';
import { signWebhookPayload } from '@/server/crypto';
import { db } from '@/server/db';
import { priceTransfer } from '@/server/fx';
import { cashInLimitsFor, getTierLimits } from '@/server/kyc/limits';
import { verifyLedgerIntegrity } from '@/server/ledger';
import { previewTopUp } from '@/server/linked-accounts';
import { MAX_AMOUNT_MINOR } from '@/server/money';
import { getReceiptPdf } from '@/server/receipts';
import type { ActionContext } from '@/server/rbac';
import { exportReport } from '@/server/reports';
import { createTransfer, reverseTransfer, topUpWallet } from '@/server/transfers';

import { withTestDatabase } from '../helpers/db';
import {
  createCustomer,
  createStaff,
  idem,
  providerId,
  systemBalance,
  walletBalance,
} from '../helpers/factories';

/**
 * Regression tests for the defects found by the adversarial security review: unlimited cash-in,
 * amounts that overflow the ledger, TOTP replay, webhook quota exhaustion by forged calls,
 * dropped webhook redeliveries, and hostile strings in exports and receipts.
 */

withTestDatabase();

const settledCodes = async (promises: Array<Promise<unknown>>): Promise<string[]> =>
  (await Promise.allSettled(promises)).map((result) =>
    result.status === 'fulfilled'
      ? 'OK'
      : ((result.reason as { code?: string } | null)?.code ?? 'UNEXPECTED'),
  );

describe('cash-in abuse', () => {
  it('an unverified customer cannot load more than the tier allows — let alone 10^17', async () => {
    const mtn = await providerId('mtn-momo-cm');
    const customer = await createCustomer({ tier: 'TIER_0' });
    const floatBefore = await systemBalance('SETTLEMENT', 'XAF');
    const base = { walletId: customer.walletId, providerId: mtn, accountNumber: '+237670001111' };

    // The original attack: 9 × 10^17 XAF from a freshly registered account. Refused outright
    // by the amount ceiling, before pricing can even multiply it.
    await expect(
      topUpWallet(customer.ctx, {
        ...base,
        amount: 900_000_000_000_000_000n,
        idempotencyKey: idem('abuse'),
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
    // Inside the ceiling but far beyond a tier 0 allowance (≈ USD 8 000).
    await expect(
      topUpWallet(customer.ctx, { ...base, amount: 5_000_000n, idempotencyKey: idem('abuse') }),
    ).rejects.toMatchObject({ code: 'KYC_REQUIRED', details: { kind: 'cashIn' } });
    await expect(previewTopUp(customer.ctx, { ...base, amount: 5_000_000n })).rejects.toMatchObject(
      { code: 'KYC_REQUIRED' },
    );
    expect(await walletBalance(customer.walletId)).toBe(0n);
    expect(await systemBalance('SETTLEMENT', 'XAF')).toBe(floatBefore);
    expect(await db.transfer.count({ where: { recipientUserId: customer.id } })).toBe(0);

    // A modest top-up still works.
    const ok = await topUpWallet(customer.ctx, {
      ...base,
      amount: 20_000n,
      idempotencyKey: idem('abuse'),
    });
    expect(ok.transfer.status).toBe('COMPLETED');
    expect(await walletBalance(customer.walletId)).toBe(ok.transfer.receiveAmount);
  });

  it('parallel top-ups cannot each spend the same daily allowance', async () => {
    const mtn = await providerId('mtn-momo-cm');
    const customer = await createCustomer({ tier: 'TIER_0' });
    const allowance = cashInLimitsFor((await getTierLimits()).TIER_0);
    // ≈ USD 99 each: three fit into the tier 0 daily cash-in allowance (USD 300), eight do not.
    const codes = await settledCodes(
      Array.from({ length: 8 }, () =>
        topUpWallet(customer.ctx, {
          walletId: customer.walletId,
          providerId: mtn,
          accountNumber: '+237670001111',
          amount: 60_000n,
          idempotencyKey: idem('parallel-topup'),
        }),
      ),
    );
    expect(codes.filter((code) => code === 'OK').length).toBeGreaterThan(0);
    expect(codes.filter((code) => code === 'LIMIT_EXCEEDED').length).toBeGreaterThan(0);
    expect(codes.every((code) => code === 'OK' || code === 'LIMIT_EXCEEDED')).toBe(true);
    const loaded = await db.transfer.aggregate({
      where: { recipientUserId: customer.id, type: 'TOPUP' },
      _sum: { sendAmountUsd: true, receiveAmount: true },
    });
    expect(loaded._sum.sendAmountUsd ?? 0n).toBeLessThanOrEqual(allowance.daily);
    expect(await walletBalance(customer.walletId)).toBe(loaded._sum.receiveAmount ?? 0n);
  });

  it('parallel transfers cannot each spend the same daily send allowance', async () => {
    // Tier 0: about USD 50 per transfer and USD 100 per day. Each transfer is ≈ USD 41.
    const limits = (await getTierLimits()).TIER_0;
    for (let round = 0; round < 3; round += 1) {
      const sender = await createCustomer({ tier: 'TIER_0', balance: 1_000_000n });
      const recipient = await createCustomer();
      const codes = await settledCodes(
        Array.from({ length: 8 }, () =>
          createTransfer(sender.ctx, {
            senderWalletId: sender.walletId,
            recipient: { kind: 'WALLET', identifier: recipient.phone },
            amount: 25_000n,
            idempotencyKey: idem('parallel-send'),
          }),
        ),
      );
      expect(codes.every((code) => code === 'OK' || code === 'LIMIT_EXCEEDED')).toBe(true);
      const sent = await db.transfer.aggregate({
        where: { senderUserId: sender.id },
        _sum: { sendAmountUsd: true },
        _count: true,
      });
      expect(sent._count, `round ${round}`).toBe(2);
      expect(sent._sum.sendAmountUsd ?? 0n).toBeLessThanOrEqual(limits.daily);
    }
  });

  it('a request that started earlier but ran later still sees what was sent meanwhile', async () => {
    // The request timestamp is taken before the request queues for the sender's lock. A request
    // that started later can therefore commit first; the earlier one must still count it.
    const sender = await createCustomer({ tier: 'TIER_0', balance: 1_000_000n });
    const recipient = await createCustomer();
    const today = new Date();
    const noon = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12),
    );
    const send = (startedAt: Date) =>
      createTransfer(
        sender.ctx,
        {
          senderWalletId: sender.walletId,
          recipient: { kind: 'WALLET', identifier: recipient.phone },
          amount: 25_000n, // ≈ USD 41; tier 0 may send about USD 100 a day
          idempotencyKey: idem('late-start'),
        },
        { now: startedAt },
      );
    await send(new Date(noon.getTime() + 5_000));
    await send(noon);
    await expect(send(noon)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(await db.transfer.count({ where: { senderUserId: sender.id } })).toBe(2);
  });

  it('a retried top-up with the same key is collected once, even in parallel', async () => {
    const mtn = await providerId('mtn-momo-cm');
    const customer = await createCustomer();
    const input = {
      walletId: customer.walletId,
      providerId: mtn,
      accountNumber: '+237670001111',
      amount: 40_000n,
      idempotencyKey: idem('same-key'),
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => topUpWallet(customer.ctx, input)),
    );
    expect(new Set(results.map((result) => result.transfer.id)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(await db.journal.count({ where: { transferId: results[0]?.transfer.id } })).toBe(1);
    expect(await walletBalance(customer.walletId)).toBe(results[0]?.transfer.receiveAmount);
  });

  it('refuses amounts beyond the ledger ceiling everywhere money is priced', async () => {
    const sender = await createCustomer({ balance: 1_000_000n });
    const recipient = await createCustomer();
    const tooMuch = MAX_AMOUNT_MINOR + 1n;
    await expect(
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: { kind: 'WALLET', identifier: recipient.phone },
        amount: tooMuch,
        idempotencyKey: idem('ceiling'),
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
    const pricing = {
      type: 'W2W' as const,
      deliveryMethod: 'WALLET' as const,
      sourceCountry: 'CM',
      targetCountry: 'CM',
      sourceCurrency: 'XAF',
      targetCurrency: 'XAF',
    };
    await expect(priceTransfer(db, { ...pricing, sendAmount: tooMuch })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    for (const sendAmount of [0n, -1n]) {
      await expect(priceTransfer(db, { ...pricing, sendAmount })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    }
    expect(await walletBalance(sender.walletId)).toBe(1_000_000n);
  });

  it('does not ask the operator to reverse a top-up the wallet can no longer cover', async () => {
    const admin = await createStaff('ADMIN');
    const mtn = await providerId('mtn-momo-cm');
    const customer = await createCustomer();
    const other = await createCustomer();
    const { transfer: topUp } = await topUpWallet(customer.ctx, {
      walletId: customer.walletId,
      providerId: mtn,
      accountNumber: '+237670001111',
      amount: 100_000n,
      idempotencyKey: idem('rev-topup'),
    });
    expect(topUp.status).toBe('COMPLETED');
    await createTransfer(customer.ctx, {
      senderWalletId: customer.walletId,
      recipient: { kind: 'WALLET', identifier: other.phone },
      amount: 90_000n,
      idempotencyKey: idem('spend'),
    });
    await expect(
      reverseTransfer(admin.ctx, topUp.id, 'Payer disputes the collection'),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      message: 'The wallet no longer holds enough funds to reverse this top-up',
    });
    // Refused before the provider was involved: no failed-reversal audit row, nothing posted.
    expect(
      await db.auditLog.count({ where: { action: 'transfer.reverse', resourceId: topUp.id } }),
    ).toBe(0);
    expect((await db.transfer.findUniqueOrThrow({ where: { id: topUp.id } })).status).toBe(
      'COMPLETED',
    );
    for (const row of await verifyLedgerIntegrity()) expect(row.balanced).toBe(true);
  });
});

describe('AML history windows', () => {
  it('structuring is caught even when the request started before the earlier transfers landed', async () => {
    const sender = await createCustomer({ balance: 20_000_000n });
    const recipient = await createCustomer();
    const today = new Date();
    const noon = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12),
    );
    const send = (startedAt: Date) =>
      createTransfer(
        sender.ctx,
        {
          senderWalletId: sender.walletId,
          recipient: { kind: 'WALLET', identifier: recipient.phone },
          amount: 1_640_000n, // ≈ USD 2 700: just under the USD 3 000 hold threshold
          idempotencyKey: idem('structuring'),
        },
        { now: startedAt },
      );
    // Three transfers from requests that started a few seconds after this one…
    for (const offset of [5_000, 6_000, 7_000]) await send(new Date(noon.getTime() + offset));
    // …and the one that started first but only now gets the sender's lock.
    const { transfer } = await send(noon);
    expect(transfer.amlFlags).toContain('AML-020');
    expect(transfer.status).toBe('ON_HOLD');
  });
});

describe('TOTP replay', () => {
  it('a code that signed someone in cannot sign in a second time', async () => {
    const email = `mfa-replay-${Date.now()}@test.local`;
    const password = 'Correct-Horse-9';
    const user = await registerCustomer({
      email,
      password,
      fullName: 'Replay Test',
      countryCode: 'CM',
    });
    const ctx: ActionContext = {
      actor: { type: 'USER', id: user.id, role: 'CUSTOMER', label: email, partnerId: null },
    };
    const { secret } = await beginMfaEnrolment(ctx);
    await confirmMfaEnrolment(ctx, totpCode(secret));

    const code = totpCode(secret);
    const first = await login({ email, password, totpCode: code });
    expect(first.status).toBe('OK');
    // The attacker knows the password and saw the code being typed.
    await expect(login({ email, password, totpCode: code })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'This code was already used. Wait for the next one.',
    });
    expect(await db.session.count({ where: { userId: user.id, mfaVerified: true } })).toBe(1);
    // The next code (one step ahead, inside the drift window) works — once.
    const next = totpCode(secret, new Date(Date.now() + 30_000));
    expect((await login({ email, password, totpCode: next })).status).toBe('OK');
    await expect(login({ email, password, totpCode: next })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('provider webhooks under attack', () => {
  it('a flood of forged calls does not use up the allowance of real webhooks', async () => {
    const admin = await createStaff('ADMIN');
    const { generatedSecret } = await rotateWebhookSecret(
      admin.ctx,
      await providerId('orange-money-cm'),
    );
    const secret = generatedSecret ?? '';
    const forged = JSON.stringify({ eventId: 'forged', reference: 'BRNOPE', status: 'SUCCESS' });
    // More than the whole per-minute allowance (600), all unsigned / wrongly signed.
    const now = new Date();
    for (let batch = 0; batch < 13; batch += 1) {
      const codes = await settledCodes(
        Array.from({ length: 50 }, (_, index) =>
          handleProviderWebhook({
            providerCode: 'orange-money-cm',
            rawBody: forged,
            signature: index % 2 === 0 ? null : signWebhookPayload('whsec_wrong', forged, now),
            now,
          }),
        ),
      );
      expect(codes.every((code) => code === 'UNAUTHENTICATED' || code === 'RATE_LIMITED')).toBe(
        true,
      );
    }
    // The provider's genuine, signed webhook still gets through.
    const body = JSON.stringify({
      eventId: 'evt-real-1',
      reference: 'BRUNKNOWN',
      status: 'SUCCESS',
    });
    const result = await handleProviderWebhook({
      providerCode: 'orange-money-cm',
      rawBody: body,
      signature: signWebhookPayload(secret, body, now),
      now,
    });
    expect(result).toMatchObject({ outcome: 'IGNORED' });
  });

  it('a redelivery of an event that failed on our side is processed, exactly once', async () => {
    const admin = await createStaff('ADMIN');
    const mtn = await providerId('mtn-momo-cm');
    const { generatedSecret } = await rotateWebhookSecret(admin.ctx, mtn);
    const secret = generatedSecret ?? '';
    const sender = await createCustomer({ balance: 300_000n });
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      // Suffix 0006: stays pending until a webhook arrives.
      recipient: {
        kind: 'MOBILE_MONEY',
        providerId: mtn,
        accountNumber: '+237670020006',
        name: 'Pending Payee',
      },
      amount: 50_000n,
      idempotencyKey: idem('redelivery'),
    });
    expect(transfer.status).toBe('PROCESSING');
    const payload = { eventId: 'evt-retry-1', reference: transfer.reference, status: 'SUCCESS' };
    // The first delivery was recorded but processing crashed (e.g. the database went away).
    await db.providerWebhookEvent.create({
      data: {
        providerId: mtn,
        eventId: payload.eventId,
        eventType: 'transfer.status',
        payload,
        status: 'FAILED',
        error: 'connection terminated',
      },
    });
    const deliver = () => {
      const body = JSON.stringify(payload);
      return handleProviderWebhook({
        providerCode: 'mtn-momo-cm',
        rawBody: body,
        signature: signWebhookPayload(secret, body),
      });
    };
    // The provider retries — twice at once, for good measure.
    const outcomes = (await Promise.all([deliver(), deliver(), deliver()])).map(
      (result) => result.outcome,
    );
    expect(outcomes.filter((outcome) => outcome === 'PROCESSED')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'DUPLICATE')).toHaveLength(2);
    expect((await db.transfer.findUniqueOrThrow({ where: { id: transfer.id } })).status).toBe(
      'COMPLETED',
    );
    expect(await db.journal.count({ where: { transferId: transfer.id, kind: 'RELEASE' } })).toBe(1);
    // And a replay after success stays a duplicate.
    expect((await deliver()).outcome).toBe('DUPLICATE');
  });
});

describe('hostile strings', () => {
  it('names and notes cannot inject formulas into exports or break the receipt PDF', async () => {
    const admin = await createStaff('ADMIN');
    const sender = await createCustomer({
      balance: 500_000n,
      fullName: '=HYPERLINK("https://evil.example","pay")',
    });
    const recipient = await createCustomer({
      fullName: "@SUM(1+1)*cmd|' /C calc'!A0 張偉 😀\r\nX",
    });
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.phone },
      amount: 10_000n,
      note: '+1+1 <script>alert(1)</script> ‮%PDF',
      idempotencyKey: idem('hostile'),
    });
    expect(transfer.status).toBe('COMPLETED');

    const csv = await exportReport(admin.ctx, 'transfers', 'csv');
    const text = Buffer.from(csv.data).toString('utf8');
    const cells = text.split(/[\n,]/).map((cell) => cell.replace(/^"/, ''));
    // No cell may start with a character a spreadsheet would evaluate.
    for (const cell of cells) expect(cell).not.toMatch(/^[=+@\t\r]/);
    expect(text).toContain("'=HYPERLINK");
    expect(csv.fileName).toMatch(/^[A-Za-z0-9._-]+$/);

    const pdf = await getReceiptPdf(sender.ctx, transfer.id);
    expect(Buffer.from(pdf.data.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(pdf.fileName).toMatch(/^[A-Za-z0-9._-]+$/);
    // The recipient may fetch their redacted receipt; a stranger may not.
    await expect(getReceiptPdf(recipient.ctx, transfer.id)).resolves.toBeDefined();
    const stranger = await createCustomer();
    await expect(getReceiptPdf(stranger.ctx, transfer.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
