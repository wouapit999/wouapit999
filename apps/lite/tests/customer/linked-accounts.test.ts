import { describe, expect, it } from 'vitest';

import { revokeOtherOwnSessions, revokeOwnSession } from '@/server/auth/own-sessions';
import { archiveBeneficiary, createBeneficiary, listBeneficiaries } from '@/server/beneficiaries';
import { db } from '@/server/db';
import {
  OWN_ACCOUNT_RELATIONSHIP,
  getLinkedAccount,
  isLinkedAccount,
  linkMobileMoneyAccount,
  listLinkedAccounts,
  previewTopUp,
  unlinkAccount,
} from '@/server/linked-accounts';
import { createTransfer, topUpWallet } from '@/server/transfers';

import { withTestDatabase } from '../helpers/db';
import { createCustomer, createStaff, idem, providerId, walletBalance } from '../helpers/factories';

withTestDatabase();

const MISSING = '00000000-0000-4000-8000-000000000000';

async function auditActions(resourceId: string): Promise<string[]> {
  const rows = await db.auditLog.findMany({ where: { resourceId }, orderBy: { createdAt: 'asc' } });
  return rows.map((row) => row.action);
}

describe('linked mobile-money accounts', () => {
  it('links an account the operator validates, keeps the holder name and audits it', async () => {
    const customer = await createCustomer({ country: 'CM' });
    const mtn = await providerId('mtn-momo-cm');

    const linked = await linkMobileMoneyAccount(customer.ctx, {
      providerId: mtn,
      accountNumber: '+237 670 55 12 34',
      nickname: 'My MoMo',
    });

    expect(linked).toMatchObject({
      providerId: mtn,
      providerCode: 'mtn-momo-cm',
      simulated: true,
      accountNumber: '+237670551234',
      nickname: 'My MoMo',
      currency: 'XAF',
      countryCode: 'CM',
    });
    expect(linked.accountName).toMatch(/^Simulated Holder /);
    expect(await listLinkedAccounts(customer.ctx)).toHaveLength(1);
    expect(await auditActions(linked.id)).toEqual(['wallet.link']);
  });

  it('refuses an account the operator does not know, and never stores it', async () => {
    const customer = await createCustomer({ country: 'CM' });
    await expect(
      linkMobileMoneyAccount(customer.ctx, {
        providerId: await providerId('mtn-momo-cm'),
        accountNumber: '+237670000000',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { accountNumber: expect.any(Array) },
    });
    expect(await listLinkedAccounts(customer.ctx)).toEqual([]);
  });

  it('only links operators of the country of residence, and only active ones', async () => {
    const customer = await createCustomer({ country: 'CM' });
    await expect(
      linkMobileMoneyAccount(customer.ctx, {
        providerId: await providerId('unitel-money-ao'),
        accountNumber: '+244923001234',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', fieldErrors: { providerId: expect.any(Array) } });
    await expect(
      linkMobileMoneyAccount(customer.ctx, {
        providerId: await providerId('mtn-momo-ng'),
        accountNumber: '+2348030001234',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      linkMobileMoneyAccount(customer.ctx, { providerId: MISSING, accountNumber: '+237670551234' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('refuses the same account twice, and a number already saved as a beneficiary', async () => {
    const customer = await createCustomer({ country: 'CM' });
    const orange = await providerId('orange-money-cm');
    await linkMobileMoneyAccount(customer.ctx, {
      providerId: orange,
      accountNumber: '+237690112233',
    });
    await expect(
      linkMobileMoneyAccount(customer.ctx, {
        providerId: orange,
        accountNumber: '+237 690 11 22 33',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('already linked'),
    });

    await createBeneficiary(customer.ctx, {
      fullName: 'Cousin Demo',
      method: 'MOBILE_MONEY',
      providerId: orange,
      accountNumber: '+237690445566',
    });
    await expect(
      linkMobileMoneyAccount(customer.ctx, { providerId: orange, accountNumber: '+237690445566' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('beneficiaries'),
    });
  });

  it('keeps linked accounts apart from beneficiaries and private to their owner', async () => {
    const owner = await createCustomer({ country: 'CM' });
    const other = await createCustomer({ country: 'CM' });
    const staff = await createStaff('ADMIN');
    const linked = await linkMobileMoneyAccount(owner.ctx, {
      providerId: await providerId('mtn-momo-cm'),
      accountNumber: '+237670778899',
    });

    const rows = await listBeneficiaries(owner.ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.relationship).toBe(OWN_ACCOUNT_RELATIONSHIP);
    expect(rows.filter((row) => !isLinkedAccount(row))).toEqual([]);

    expect(await listLinkedAccounts(other.ctx)).toEqual([]);
    await expect(getLinkedAccount(other.ctx, linked.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(unlinkAccount(other.ctx, linked.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Staff have no linked accounts of their own and cannot touch a customer's.
    await expect(unlinkAccount(staff.ctx, linked.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await listLinkedAccounts(owner.ctx)).toHaveLength(1);
  });

  it('unlinks only linked accounts — a regular beneficiary is not affected', async () => {
    const customer = await createCustomer({ country: 'CM' });
    const mtn = await providerId('mtn-momo-cm');
    const beneficiary = await createBeneficiary(customer.ctx, {
      fullName: 'Aunt Demo',
      method: 'MOBILE_MONEY',
      providerId: mtn,
      accountNumber: '+237670334455',
    });
    await expect(unlinkAccount(customer.ctx, beneficiary.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const linked = await linkMobileMoneyAccount(customer.ctx, {
      providerId: mtn,
      accountNumber: '+237670221100',
    });
    await unlinkAccount(customer.ctx, linked.id);
    expect(await listLinkedAccounts(customer.ctx)).toEqual([]);
    expect(await auditActions(linked.id)).toEqual(['wallet.link', 'wallet.unlink']);
    await expect(unlinkAccount(customer.ctx, linked.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await archiveBeneficiary(customer.ctx, beneficiary.id);
  });

  it('tops up from a linked account and cashes out to it through the engine', async () => {
    const customer = await createCustomer({ country: 'CM', tier: 'TIER_1' });
    const linked = await linkMobileMoneyAccount(customer.ctx, {
      providerId: await providerId('mtn-momo-cm'),
      accountNumber: '+237670909090',
    });

    const topUp = await topUpWallet(customer.ctx, {
      walletId: customer.walletId,
      providerId: linked.providerId,
      accountNumber: linked.accountNumber,
      amount: 50_000n,
      idempotencyKey: idem('topup'),
    });
    expect(topUp.transfer.status).toBe('COMPLETED');
    expect(await walletBalance(customer.walletId)).toBe(50_000n);

    const cashOut = await createTransfer(customer.ctx, {
      senderWalletId: customer.walletId,
      recipient: { kind: 'BENEFICIARY', beneficiaryId: linked.id },
      amount: 20_000n,
      idempotencyKey: idem('cashout'),
    });
    expect(cashOut.transfer).toMatchObject({
      status: 'COMPLETED',
      type: 'W2W',
      deliveryMethod: 'MOBILE_MONEY',
      recipientAccount: '+237670909090',
      beneficiaryId: linked.id,
    });
    expect(await walletBalance(customer.walletId)).toBe(50_000n - cashOut.transfer.totalDebit);

    // Somebody else cannot pay out to (or through) this customer's linked account.
    const stranger = await createCustomer({ country: 'CM', balance: 30_000n });
    await expect(
      createTransfer(stranger.ctx, {
        senderWalletId: stranger.walletId,
        recipient: { kind: 'BENEFICIARY', beneficiaryId: linked.id },
        amount: 1_000n,
        idempotencyKey: idem('stranger'),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('top-up preview', () => {
  it('shows the validated holder, the fee and what will be credited — and moves nothing', async () => {
    const customer = await createCustomer({ country: 'CM', balance: 1_000n });
    const preview = await previewTopUp(customer.ctx, {
      walletId: customer.walletId,
      providerId: await providerId('mtn-momo-cm'),
      accountNumber: '+237 670 12 12 12',
      amount: 25_000n,
    });
    expect(preview).toMatchObject({
      walletId: customer.walletId,
      currency: 'XAF',
      balance: 1_000n,
      simulated: true,
      accountNumber: '+237670121212',
      amount: 25_000n,
    });
    expect(preview.accountName).toMatch(/^Simulated Holder /);
    expect(preview.creditAmount).toBe(preview.amount - preview.feeAmount);
    expect(await walletBalance(customer.walletId)).toBe(1_000n);
    expect(await db.transfer.count({ where: { recipientWalletId: customer.walletId } })).toBe(0);
  });

  it("is refused for somebody else's wallet, even for staff", async () => {
    const owner = await createCustomer({ country: 'CM' });
    const other = await createCustomer({ country: 'CM' });
    const staff = await createStaff('ADMIN');
    const input = {
      walletId: owner.walletId,
      providerId: await providerId('mtn-momo-cm'),
      accountNumber: '+237670121212',
      amount: 5_000n,
    };
    await expect(previewTopUp(other.ctx, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(previewTopUp(staff.ctx, input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an unknown account, a provider in another currency and a zero amount', async () => {
    const customer = await createCustomer({ country: 'CM' });
    const mtn = await providerId('mtn-momo-cm');
    const base = { walletId: customer.walletId, providerId: mtn, accountNumber: '+237670121212' };
    await expect(
      previewTopUp(customer.ctx, { ...base, accountNumber: '+237670000000', amount: 5_000n }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { accountNumber: expect.any(Array) },
    });
    await expect(
      previewTopUp(customer.ctx, {
        ...base,
        providerId: await providerId('unitel-money-ao'),
        amount: 5_000n,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION', fieldErrors: { providerId: expect.any(Array) } });
    await expect(previewTopUp(customer.ctx, { ...base, amount: 0n })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});

describe('own sessions', () => {
  async function openSession(userId: string): Promise<string> {
    const session = await db.session.create({
      data: { userId, expiresAt: new Date(Date.now() + 3_600_000) },
      select: { id: true },
    });
    return session.id;
  }
  const isRevoked = async (id: string): Promise<boolean> =>
    (await db.session.findUniqueOrThrow({ where: { id } })).revokedAt !== null;

  it('lets a user end their own session, never somebody else’s', async () => {
    const alice = await createCustomer();
    const bob = await createCustomer();
    const aliceSession = await openSession(alice.id);
    const bobSession = await openSession(bob.id);

    await expect(revokeOwnSession(alice.ctx, bobSession)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await isRevoked(bobSession)).toBe(false);

    await revokeOwnSession(alice.ctx, aliceSession);
    expect(await isRevoked(aliceSession)).toBe(true);
    expect(await auditActions(aliceSession)).toEqual(['auth.session.revoke']);
    await expect(revokeOwnSession(alice.ctx, aliceSession)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('ends every other session of the user and keeps the current one', async () => {
    const alice = await createCustomer();
    const bob = await createCustomer();
    const current = await openSession(alice.id);
    const phone = await openSession(alice.id);
    const laptop = await openSession(alice.id);
    const bobSession = await openSession(bob.id);

    expect(await revokeOtherOwnSessions(alice.ctx, current)).toBe(2);
    expect(await isRevoked(current)).toBe(false);
    expect(await isRevoked(phone)).toBe(true);
    expect(await isRevoked(laptop)).toBe(true);
    expect(await isRevoked(bobSession)).toBe(false);
    expect(await revokeOtherOwnSessions(alice.ctx, current)).toBe(0);
  });
});
