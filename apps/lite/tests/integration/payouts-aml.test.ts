import { describe, expect, it } from 'vitest';

import {
  getCase,
  rejectCase,
  releaseCase,
  addCaseNote,
  createSarDraft,
  fileSar,
  listAlerts,
  dismissAlert,
  escalateAlert,
  updateAmlRule,
} from '@/server/aml/cases';
import { evaluateTransfer, screenName, assessUserRisk } from '@/server/aml/engine';
import { handleProviderWebhook } from '@/server/connectors/webhooks';
import { rotateWebhookSecret } from '@/server/connectors/providers';
import { signWebhookPayload } from '@/server/crypto';
import { db } from '@/server/db';
import { verifyLedgerIntegrity } from '@/server/ledger';
import { getReconciliation } from '@/server/reports';
import { systemContext } from '@/server/rbac';
import {
  createTransfer,
  refreshTransferStatus,
  reverseTransfer,
  topUpWallet,
  rejectHeldTransfer,
} from '@/server/transfers';

import { withTestDatabase } from '../helpers/db';
import {
  createCustomer,
  createStaff,
  idem,
  providerId,
  systemBalance,
  walletBalance,
} from '../helpers/factories';

withTestDatabase();

const balanced = async (): Promise<boolean> =>
  (await verifyLedgerIntegrity()).every((row) => row.balanced);

const payout = async (
  sender: Awaited<ReturnType<typeof createCustomer>>,
  account: string,
  amount = 50_000n,
  name = 'Simulated Recipient',
) =>
  createTransfer(sender.ctx, {
    senderWalletId: sender.walletId,
    recipient: {
      kind: 'MOBILE_MONEY',
      providerId: await providerId('mtn-momo-cm'),
      accountNumber: account,
      name,
    },
    amount,
    idempotencyKey: idem('payout'),
  });

describe('mobile-money payouts through the simulator', () => {
  it('SUCCESS: reserves, pays out of the float and completes', async () => {
    const sender = await createCustomer({ balance: 500_000n });
    const floatBefore = await systemBalance('SETTLEMENT', 'XAF');
    const suspenseBefore = await systemBalance('SUSPENSE', 'XAF');
    const { transfer } = await payout(sender, '+237670001234');
    expect(transfer.status).toBe('COMPLETED');
    expect(transfer.deliveryMethod).toBe('MOBILE_MONEY');
    expect(transfer.providerRef).toMatch(/^SIM-MTN-MOMO-CM-/);
    expect(await walletBalance(sender.walletId)).toBe(500_000n - transfer.totalDebit);
    expect(floatBefore - (await systemBalance('SETTLEMENT', 'XAF'))).toBe(50_000n);
    expect(await systemBalance('SUSPENSE', 'XAF')).toBe(suspenseBefore);
    const kinds = (await db.journal.findMany({ where: { transferId: transfer.id } }))
      .map((journal) => journal.kind)
      .sort();
    expect(kinds).toEqual(['RELEASE', 'RESERVE']);
    expect(await balanced()).toBe(true);
  });

  it('FAILED: refunds the sender in full', async () => {
    const sender = await createCustomer({ balance: 500_000n });
    const { transfer } = await payout(sender, '+237670000001');
    expect(transfer.status).toBe('FAILED');
    expect(transfer.failureCode).toBe('RECIPIENT_LIMIT_EXCEEDED');
    expect(await walletBalance(sender.walletId)).toBe(500_000n);
    const kinds = (await db.journal.findMany({ where: { transferId: transfer.id } }))
      .map((journal) => journal.kind)
      .sort();
    expect(kinds).toEqual(['REFUND', 'RESERVE']);
    expect(
      await db.notification.count({ where: { userId: sender.id, type: 'transfer.failed' } }),
    ).toBe(1);
    expect(await balanced()).toBe(true);
  });

  it('rejects an account the operator does not know before any money moves', async () => {
    const sender = await createCustomer({ balance: 500_000n });
    await expect(payout(sender, '+237670000000')).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await walletBalance(sender.walletId)).toBe(500_000n);
  });

  it('PENDING then SUCCESS on status refresh; funds wait in suspense meanwhile', async () => {
    const sender = await createCustomer({ balance: 500_000n });
    const suspenseBefore = await systemBalance('SUSPENSE', 'XAF');
    const { transfer } = await payout(sender, '+237670000003');
    expect(transfer.status).toBe('PROCESSING');
    expect((await systemBalance('SUSPENSE', 'XAF')) - suspenseBefore).toBe(transfer.totalDebit);
    expect(
      (await getReconciliation(systemContext())).suspense.find((row) => row.currency === 'XAF')
        ?.matches,
    ).toBe(true);

    const refreshed = await refreshTransferStatus(sender.ctx, transfer.id);
    expect(refreshed.status).toBe('COMPLETED');
    expect(await systemBalance('SUSPENSE', 'XAF')).toBe(suspenseBefore);
    // Refreshing again is a no-op.
    expect((await refreshTransferStatus(sender.ctx, transfer.id)).status).toBe('COMPLETED');
    expect(await db.journal.count({ where: { transferId: transfer.id } })).toBe(2);
  });

  it('PENDING then FAILED on status refresh refunds', async () => {
    const sender = await createCustomer({ balance: 500_000n });
    const { transfer } = await payout(sender, '+237670000004');
    expect(transfer.status).toBe('PROCESSING');
    const refreshed = await refreshTransferStatus(sender.ctx, transfer.id);
    expect(refreshed.status).toBe('FAILED');
    expect(refreshed.failureCode).toBe('PROVIDER_REJECTED');
    expect(await walletBalance(sender.walletId)).toBe(500_000n);
  });

  it('TIMEOUT keeps the transfer processing until a later status check', async () => {
    const sender = await createCustomer({ balance: 500_000n });
    const { transfer } = await payout(sender, '+237670000005');
    expect(transfer.status).toBe('PROCESSING');
    expect(transfer.providerRef).toBeNull();
    expect(await walletBalance(sender.walletId)).toBe(500_000n - transfer.totalDebit);
    const refreshed = await refreshTransferStatus(sender.ctx, transfer.id);
    expect(refreshed.status).toBe('COMPLETED');
    expect(refreshed.providerRef).toMatch(/^SIM-/);
  });

  it("does not let another customer refresh someone else's transfer", async () => {
    const sender = await createCustomer({ balance: 500_000n });
    const other = await createCustomer();
    const { transfer } = await payout(sender, '+237670000006');
    await expect(refreshTransferStatus(other.ctx, transfer.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reverses a payout only when the operator confirms', async () => {
    const admin = await createStaff('ADMIN');
    const sender = await createCustomer({ balance: 500_000n });
    const ok = await payout(sender, '+237670001111');
    const refused = await payout(sender, '+237670000007');
    expect(refused.transfer.status).toBe('COMPLETED');

    await expect(
      reverseTransfer(admin.ctx, refused.transfer.id, 'Sent to the wrong number'),
    ).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
    expect(
      (await db.transfer.findUniqueOrThrow({ where: { id: refused.transfer.id } })).status,
    ).toBe('COMPLETED');

    const reversed = await reverseTransfer(admin.ctx, ok.transfer.id, 'Sent to the wrong number');
    expect(reversed.status).toBe('REVERSED');
    expect(await walletBalance(sender.walletId)).toBe(500_000n - refused.transfer.totalDebit);
    expect(await balanced()).toBe(true);
  });
});

describe('provider webhooks', () => {
  const send = async (
    code: string,
    secret: string,
    payload: Record<string, unknown>,
    at = new Date(),
  ) => {
    const rawBody = JSON.stringify(payload);
    return handleProviderWebhook({
      providerCode: code,
      rawBody,
      signature: signWebhookPayload(secret, rawBody, at),
      now: at,
    });
  };

  it('completes a pending payout once, ignores replays and rejects bad signatures', async () => {
    const admin = await createStaff('ADMIN');
    const sender = await createCustomer({ balance: 500_000n });
    const { generatedSecret } = await rotateWebhookSecret(
      admin.ctx,
      await providerId('mtn-momo-cm'),
    );
    expect(generatedSecret).toMatch(/^whsec_/);
    const { transfer } = await payout(sender, '+237670000006');
    expect(transfer.status).toBe('PROCESSING');

    const payload = {
      eventId: 'evt-1001',
      type: 'transfer.status',
      reference: transfer.reference,
      status: 'SUCCESS',
    };

    // Wrong secret, missing header, stale timestamp.
    await expect(
      send('mtn-momo-cm', 'whsec_wrong_secret_value_000000', payload),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(
      handleProviderWebhook({
        providerCode: 'mtn-momo-cm',
        rawBody: JSON.stringify(payload),
        signature: null,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const stale = new Date(Date.now() - 10 * 60_000);
    await expect(
      handleProviderWebhook({
        providerCode: 'mtn-momo-cm',
        rawBody: JSON.stringify(payload),
        signature: signWebhookPayload(generatedSecret!, JSON.stringify(payload), stale),
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    // A tampered body no longer matches its signature.
    await expect(
      handleProviderWebhook({
        providerCode: 'mtn-momo-cm',
        rawBody: JSON.stringify({ ...payload, status: 'FAILED' }),
        signature: signWebhookPayload(generatedSecret!, JSON.stringify(payload)),
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await db.transfer.findUniqueOrThrow({ where: { id: transfer.id } })).status).toBe(
      'PROCESSING',
    );

    const first = await send('mtn-momo-cm', generatedSecret!, payload);
    expect(first).toMatchObject({ outcome: 'PROCESSED', transferStatus: 'COMPLETED' });

    // Replay of the same event id: acknowledged, not applied again.
    const replay = await send('mtn-momo-cm', generatedSecret!, payload);
    expect(replay).toEqual({ outcome: 'DUPLICATE' });
    expect(await db.providerWebhookEvent.count({ where: { eventId: 'evt-1001' } })).toBe(1);
    expect(await db.journal.count({ where: { transferId: transfer.id } })).toBe(2);

    // A different event for an already-final transfer is ignored.
    const late = await send('mtn-momo-cm', generatedSecret!, {
      ...payload,
      eventId: 'evt-1002',
      status: 'FAILED',
    });
    expect(late.outcome).toBe('IGNORED');
    expect(await walletBalance(sender.walletId)).toBe(500_000n - transfer.totalDebit);
    expect(await balanced()).toBe(true);
  });

  it('accepts the previous secret for 24 h after a rotation, and refuses providers without one', async () => {
    const admin = await createStaff('ADMIN');
    const id = await providerId('orange-money-cm');
    const payload = { eventId: 'evt-rot-1', reference: 'BRNOPE000000', status: 'SUCCESS' };
    await expect(
      send('orange-money-cm', 'whsec_anything_long_enough_0000', payload),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const first = await rotateWebhookSecret(admin.ctx, id);
    const second = await rotateWebhookSecret(admin.ctx, id);
    expect(second.version).toBe(first.version + 1);
    expect((await send('orange-money-cm', first.generatedSecret!, payload)).outcome).toBe(
      'IGNORED',
    );
    expect(
      (await send('orange-money-cm', second.generatedSecret!, { ...payload, eventId: 'evt-rot-2' }))
        .outcome,
    ).toBe('IGNORED');
    // After the grace period only the current secret works.
    await db.providerSecret.updateMany({
      where: { providerId: id, kind: 'WEBHOOK_SECRET', version: first.version },
      data: { retiredAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    await expect(
      send('orange-money-cm', first.generatedSecret!, { ...payload, eventId: 'evt-rot-3' }),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(send('no-such-provider', 'x', payload)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('top-up', () => {
  it('credits the wallet from the float once the provider confirms', async () => {
    const customer = await createCustomer();
    const floatBefore = await systemBalance('SETTLEMENT', 'XAF');
    const input = {
      walletId: customer.walletId,
      providerId: await providerId('orange-money-cm'),
      accountNumber: '+237690112233',
      amount: 75_000n,
      idempotencyKey: idem('topup'),
    };
    const { transfer } = await topUpWallet(customer.ctx, input);
    expect(transfer).toMatchObject({
      type: 'TOPUP',
      status: 'COMPLETED',
      receiveAmount: 75_000n,
      feeAmount: 0n,
    });
    expect(await walletBalance(customer.walletId)).toBe(75_000n);
    expect((await systemBalance('SETTLEMENT', 'XAF')) - floatBefore).toBe(75_000n);

    const replay = await topUpWallet(customer.ctx, input);
    expect(replay.replayed).toBe(true);
    expect(await walletBalance(customer.walletId)).toBe(75_000n);
    expect(await balanced()).toBe(true);
  });

  it('posts nothing when the collection fails, and refuses foreign wallets and currencies', async () => {
    const customer = await createCustomer();
    const other = await createCustomer();
    const mtn = await providerId('mtn-momo-cm');
    const failed = await topUpWallet(customer.ctx, {
      walletId: customer.walletId,
      providerId: mtn,
      accountNumber: '+237670000002',
      amount: 10_000n,
      idempotencyKey: idem('topup'),
    });
    expect(failed.transfer.status).toBe('FAILED');
    expect(await walletBalance(customer.walletId)).toBe(0n);
    expect(await db.journal.count({ where: { transferId: failed.transfer.id } })).toBe(0);

    await expect(
      topUpWallet(other.ctx, {
        walletId: customer.walletId,
        providerId: mtn,
        accountNumber: '+237670009999',
        amount: 10_000n,
        idempotencyKey: idem('topup'),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      topUpWallet(customer.ctx, {
        walletId: customer.walletId,
        providerId: await providerId('unitel-money-ao'),
        accountNumber: '+244923009999',
        amount: 10_000n,
        idempotencyKey: idem('topup'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('AML screening and the hold lifecycle (rule 6)', () => {
  // ≈ USD 3 293 — above the USD 3 000 "large transfer" rule (HOLD).
  const LARGE = 2_000_000n;

  it('holds a flagged transfer with funds reserved, then releases it', async () => {
    const compliance = await createStaff('COMPLIANCE');
    const sender = await createCustomer({ balance: 5_000_000n });
    const recipient = await createCustomer();
    const suspenseBefore = await systemBalance('SUSPENSE', 'XAF');

    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.phone },
      amount: LARGE,
      idempotencyKey: idem('aml'),
    });
    expect(transfer.status).toBe('ON_HOLD');
    expect(transfer.amlFlags).toContain('AML-001');
    // Funds left the wallet into suspense; the recipient has nothing yet.
    expect(await walletBalance(sender.walletId)).toBe(5_000_000n - transfer.totalDebit);
    expect((await systemBalance('SUSPENSE', 'XAF')) - suspenseBefore).toBe(transfer.totalDebit);
    expect(await walletBalance(recipient.walletId)).toBe(0n);

    const amlCase = await db.amlCase.findFirstOrThrow({ where: { transferId: transfer.id } });
    expect(amlCase.status).toBe('OPEN');
    expect(amlCase.reference).toMatch(/^AML-\d{4}-/);
    const alerts = await db.amlAlert.findMany({ where: { transferId: transfer.id } });
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(
      alerts.every((alert) => alert.caseId === amlCase.id && alert.status === 'ESCALATED'),
    ).toBe(true);
    expect(
      await db.notification.count({ where: { userId: compliance.id, type: 'aml.case.opened' } }),
    ).toBe(1);

    // The customer cannot release their own transfer.
    await expect(releaseCase(sender.ctx, amlCase.id, 'please release it')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    await addCaseNote(compliance.ctx, amlCase.id, 'Source of funds documented: property sale.');
    const released = await releaseCase(
      compliance.ctx,
      amlCase.id,
      'Documents verified, legitimate transfer.',
    );
    expect(released.amlCase.status).toBe('RELEASED');
    expect(released.transfer?.status).toBe('COMPLETED');
    expect(await walletBalance(recipient.walletId)).toBe(LARGE);
    expect(await systemBalance('SUSPENSE', 'XAF')).toBe(suspenseBefore);
    const detail = await getCase(compliance.ctx, amlCase.id);
    expect(detail.notes.length).toBe(2);
    expect(detail.alerts.every((alert) => alert.status === 'RESOLVED')).toBe(true);
    await expect(releaseCase(compliance.ctx, amlCase.id, 'second time')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(await balanced()).toBe(true);
  });

  it('rejects a held transfer and refunds every unit, fee included', async () => {
    const compliance = await createStaff('COMPLIANCE');
    const sender = await createCustomer({ balance: 5_000_000n });
    const recipient = await createCustomer();
    const feesBefore = await systemBalance('FEE_REVENUE', 'XAF');
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.phone },
      amount: LARGE,
      idempotencyKey: idem('aml'),
    });
    expect(transfer.status).toBe('ON_HOLD');
    const amlCase = await db.amlCase.findFirstOrThrow({ where: { transferId: transfer.id } });

    const rejected = await rejectCase(
      compliance.ctx,
      amlCase.id,
      'Unable to establish the source of funds.',
    );
    expect(rejected.transfer?.status).toBe('REJECTED');
    expect(await walletBalance(sender.walletId)).toBe(5_000_000n);
    expect(await walletBalance(recipient.walletId)).toBe(0n);
    expect(await systemBalance('FEE_REVENUE', 'XAF')).toBe(feesBefore);
    const kinds = (await db.journal.findMany({ where: { transferId: transfer.id } }))
      .map((journal) => journal.kind)
      .sort();
    expect(kinds).toEqual(['REFUND', 'RESERVE']);
    expect(
      await db.notification.count({ where: { userId: sender.id, type: 'transfer.rejected' } }),
    ).toBe(1);

    // SAR workflow on the rejected case: draft → filed with a reference.
    const draft = await createSarDraft(
      compliance.ctx,
      amlCase.id,
      'Customer attempted a large transfer and could not evidence the source of funds.',
    );
    expect(draft.status).toBe('DRAFT');
    const filed = await fileSar(compliance.ctx, draft.id, { regulator: 'ANIF (demo)' });
    expect(filed.status).toBe('FILED');
    expect(filed.reference).toMatch(/^SAR-\d{4}-/);
    await expect(
      fileSar(compliance.ctx, draft.id, { regulator: 'ANIF (demo)' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    // A rejected transfer raises the customer's risk score.
    const risk = await assessUserRisk(db, sender.id);
    expect(risk.factors.map((factor) => factor.code)).toContain('REJECTED_TRANSFERS');
    expect(await balanced()).toBe(true);
  });

  it('holds a mobile-money payout before the operator is ever called, and pays it on release', async () => {
    const compliance = await createStaff('COMPLIANCE');
    const sender = await createCustomer({ balance: 5_000_000n });
    const { transfer } = await payout(sender, '+237670004321', LARGE);
    expect(transfer.status).toBe('ON_HOLD');
    expect(
      await db.transferEvent.count({
        where: { transferId: transfer.id, type: 'SENT_TO_PROVIDER' },
      }),
    ).toBe(0);
    const amlCase = await db.amlCase.findFirstOrThrow({ where: { transferId: transfer.id } });
    const released = await releaseCase(
      compliance.ctx,
      amlCase.id,
      'Cleared after document review.',
    );
    expect(released.transfer?.status).toBe('COMPLETED');
    expect(
      await db.transferEvent.count({
        where: { transferId: transfer.id, type: 'SENT_TO_PROVIDER' },
      }),
    ).toBe(1);
    expect(await balanced()).toBe(true);
  });

  it('holds on a sanctions name match and only flags a PEP match', async () => {
    const sender = await createCustomer({ balance: 1_000_000n });
    const sanctioned = await payout(sender, '+237670005551', 20_000n, 'Viktor D. Sanctionov');
    expect(sanctioned.transfer.status).toBe('ON_HOLD');
    expect(sanctioned.transfer.amlFlags).toContain('AML-050');

    const pep = await payout(sender, '+237670005552', 20_000n, 'Ministro Sample');
    expect(pep.transfer.status).toBe('COMPLETED');
    expect(pep.transfer.amlFlags).toEqual(['AML-051']);
    const alert = await db.amlAlert.findFirstOrThrow({ where: { transferId: pep.transfer.id } });
    expect(alert).toMatchObject({ status: 'OPEN', caseId: null, action: 'FLAG' });

    const clean = await payout(sender, '+237670005553', 20_000n, 'Marie Claire Ngono');
    expect(clean.transfer.amlFlags).toEqual([]);
    expect(await db.amlAlert.count({ where: { transferId: clean.transfer.id } })).toBe(0);
  });

  it('fuzzy screening tolerates typos, order and accents but not unrelated names', async () => {
    expect((await screenName(db, 'Sanctionov Viktor Demo'))[0]?.type).toBe('SANCTION');
    expect((await screenName(db, 'Víktor Demo Sanctionóv'))[0]?.score).toBe(100);
    expect((await screenName(db, 'Viktor Demo Sanctionof')).length).toBe(1);
    expect(await screenName(db, 'Victor Hugo')).toEqual([]);
    expect(await screenName(db, 'Viktor')).toEqual([]);
    expect(await screenName(db, 'Amina Njoya')).toEqual([]);
  });

  it('velocity and structuring rules look at the sender history', async () => {
    const sender = await createCustomer({ balance: 20_000_000n });
    const recipient = await createCustomer();
    const now = new Date();
    const base = {
      senderUserId: sender.id,
      senderName: sender.fullName,
      senderCreatedAt: new Date(now.getTime() - 90 * 86_400_000),
      recipientName: recipient.fullName,
      sourceCountry: 'CM',
      targetCountry: 'CM',
      type: 'W2W' as const,
      now,
    };
    expect((await evaluateTransfer(db, { ...base, amountUsd: 10_000n })).decision).toBe('CLEAR');
    // Two transfers of ≈ USD 2 635 (just under the USD 3 000 line)…
    for (let index = 0; index < 2; index += 1) {
      const { transfer } = await createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: { kind: 'WALLET', identifier: recipient.phone },
        amount: 1_600_000n,
        idempotencyKey: idem('structuring'),
      });
      expect(transfer.status).toBe('COMPLETED');
    }
    // …make the third one structuring (HOLD) and breach the 24 h value velocity.
    const third = await evaluateTransfer(db, { ...base, amountUsd: 263_500n, now: new Date() });
    expect(third.decision).toBe('HOLD');
    expect(third.hits.map((hit) => hit.ruleCode)).toEqual(
      expect.arrayContaining(['AML-020', 'AML-011']),
    );

    // A young account sending USD 500+ on a high-risk corridor is held by score (30 + 35 ≥ 60).
    const young = await evaluateTransfer(db, {
      ...base,
      senderUserId: null,
      senderCreatedAt: new Date(now.getTime() - 2 * 86_400_000),
      targetCountry: 'CF',
      amountUsd: 60_000n,
    });
    expect(young.hits.map((hit) => hit.ruleCode).sort()).toEqual(['AML-030', 'AML-040']);
    expect(young.decision).toBe('HOLD');
  });

  it('alerts can be dismissed or escalated; rules can be tuned; all need aml:write', async () => {
    const compliance = await createStaff('COMPLIANCE');
    const support = await createStaff('SUPPORT');
    const sender = await createCustomer({ balance: 2_000_000n });
    const a = await payout(sender, '+237670006661', 20_000n, 'Paula Exemplo Governadora');
    const b = await payout(sender, '+237670006662', 20_000n, 'Paula Exemplo Governadora');
    const alertA = await db.amlAlert.findFirstOrThrow({ where: { transferId: a.transfer.id } });
    const alertB = await db.amlAlert.findFirstOrThrow({ where: { transferId: b.transfer.id } });

    await expect(dismissAlert(support.ctx, alertA.id, 'not my job')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(
      (await dismissAlert(compliance.ctx, alertA.id, 'Different person, same name.')).status,
    ).toBe('DISMISSED');
    const escalated = await escalateAlert(compliance.ctx, alertB.id);
    expect(escalated.transferId).toBe(b.transfer.id);
    expect((await db.amlAlert.findUniqueOrThrow({ where: { id: alertB.id } })).status).toBe(
      'ESCALATED',
    );
    expect((await listAlerts(support.ctx, { status: 'DISMISSED' })).total).toBeGreaterThanOrEqual(
      1,
    );

    const rule = await db.amlRule.findUniqueOrThrow({ where: { code: 'AML-002' } });
    await expect(
      updateAmlRule(compliance.ctx, rule.id, { params: { thresholdUsd: 'abc' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const tuned = await updateAmlRule(compliance.ctx, rule.id, {
      params: { thresholdUsd: '90000' },
      score: 20,
    });
    expect(tuned.params).toEqual({ thresholdUsd: '90000' });
    expect(tuned.score).toBe(20);
    await updateAmlRule(compliance.ctx, rule.id, { params: { thresholdUsd: '70000' }, score: 15 });
  });

  it('rejectHeldTransfer without a case also refunds (direct engine call)', async () => {
    const compliance = await createStaff('COMPLIANCE');
    const sender = await createCustomer({ balance: 5_000_000n });
    const recipient = await createCustomer();
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.phone },
      amount: LARGE,
      idempotencyKey: idem('aml'),
    });
    await expect(rejectHeldTransfer(sender.ctx, transfer.id, 'no')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const rejected = await rejectHeldTransfer(compliance.ctx, transfer.id, 'Rejected directly');
    expect(rejected.status).toBe('REJECTED');
    expect(await walletBalance(sender.walletId)).toBe(5_000_000n);
  });
});
