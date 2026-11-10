import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listAuditLogs, withAudit } from '@/server/audit';
import { archiveBeneficiary, createBeneficiary, listBeneficiaries } from '@/server/beneficiaries';
import { setCountryEnabled } from '@/server/countries';
import { verifyWebhookSignature } from '@/server/crypto';
import { db } from '@/server/db';
import { saveFeeRule, setFeeRuleActive } from '@/server/fees';
import { setFxRate } from '@/server/fx';
import { verifyLedgerIntegrity } from '@/server/ledger';
import {
  applyForPartner,
  assertApiScope,
  authenticateApiKey,
  createApiKey,
  createSettlement,
  createWebhookEndpoint,
  getCommissionSummary,
  getPartnerDashboard,
  listApiKeys,
  listWebhookDeliveries,
  reviewPartner,
  revokeApiKey,
  sendTestWebhook,
} from '@/server/partners';
import { getReceipt, getReceiptPdf } from '@/server/receipts';
import {
  exportReport,
  getComplianceDashboard,
  getExecutiveDashboard,
  getOperationalDashboard,
  getReconciliation,
  getRevenueDashboard,
  getTreasuryDashboard,
  resolveRange,
} from '@/server/reports';
import { moveFloat, setTreasuryThreshold } from '@/server/treasury';
import { createTransfer, listMyTransfers } from '@/server/transfers';
import { getWallet, getWalletStatement, listMyWallets } from '@/server/wallets';

import { withTestDatabase } from '../helpers/db';
import {
  createCustomer,
  createPartner,
  createStaff,
  idem,
  providerId,
  systemBalance,
  walletBalance,
} from '../helpers/factories';

withTestDatabase();

interface Received {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
const received: Received[] = [];
let receiverUrl = '';
const server = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk: Buffer) => (body += chunk.toString()));
  request.on('end', () => {
    received.push({ headers: request.headers, body });
    response.statusCode = request.url === '/fail' ? 500 : 200;
    response.end('ok');
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  receiverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('partner onboarding and API keys', () => {
  it('self-serve application → admin approval → wallet and API key', async () => {
    const admin = await createStaff('ADMIN');
    const support = await createStaff('SUPPORT');
    const email = `shop-${Date.now()}@test.local`;
    const { partner, userId } = await applyForPartner({
      type: 'MERCHANT',
      name: 'Boutique Test',
      countryCode: 'CM',
      contactEmail: email,
      ownerName: 'Shop Owner',
      password: 'Shop-Owner-2026',
    });
    expect(partner).toMatchObject({ status: 'PENDING', currency: 'XAF' });
    expect(partner.code).toMatch(/^M-[0-9A-Z]{6}$/);
    const ownerCtx = {
      actor: {
        type: 'USER' as const,
        id: userId,
        role: 'PARTNER' as const,
        label: email,
        partnerId: partner.id,
      },
    };

    // Not active yet: no keys, and nobody can pay the code.
    await expect(
      createApiKey(ownerCtx, { name: 'too early', scopes: ['transfers:read'] }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const payer = await createCustomer({ balance: 100_000n });
    await expect(
      createTransfer(payer.ctx, {
        senderWalletId: payer.walletId,
        recipient: { kind: 'WALLET', identifier: partner.code },
        amount: 5_000n,
        idempotencyKey: idem(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      reviewPartner(support.ctx, partner.id, { decision: 'APPROVE' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const approved = await reviewPartner(admin.ctx, partner.id, {
      decision: 'APPROVE',
      commissionBps: 25,
    });
    expect(approved).toMatchObject({ status: 'ACTIVE', commissionBps: 25 });
    await expect(
      reviewPartner(admin.ctx, partner.id, { decision: 'REJECT' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect((await listMyWallets(ownerCtx)).map((wallet) => wallet.currency)).toEqual(['XAF']);

    // The key is returned once and stored only as a hash.
    const { apiKey, secret } = await createApiKey(ownerCtx, {
      name: 'Server',
      scopes: ['transfers:read', 'transfers:write'],
    });
    expect(secret).toMatch(/^brl_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    const stored = await db.apiKey.findUniqueOrThrow({ where: { id: apiKey.id } });
    expect(stored.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(await listApiKeys(ownerCtx))).not.toContain(stored.keyHash);
    expect(
      JSON.stringify(await db.auditLog.findMany({ where: { action: 'api_key.create' } })),
    ).not.toContain(secret);

    const auth = await authenticateApiKey(`Bearer ${secret}`);
    expect(auth.partner.id).toBe(partner.id);
    expect(auth.ctx.actor).toMatchObject({ type: 'API_KEY', partnerId: partner.id });
    expect(() => assertApiScope(auth, 'transfers:write')).not.toThrow();
    expect(() => assertApiScope(auth, 'wallets:read')).toThrow(/scope/);
    await expect(authenticateApiKey(`Bearer ${secret}x`)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(authenticateApiKey('Bearer nope')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(authenticateApiKey(null)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    // Another partner cannot revoke it; the owner can, and it stops working.
    const other = await createPartner();
    await expect(revokeApiKey(other.ctx, apiKey.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await revokeApiKey(ownerCtx, apiKey.id);
    await expect(authenticateApiKey(`Bearer ${secret}`)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('an API key moves money only from its own partner wallet', async () => {
    const partner = await createPartner({
      type: 'PARTNER',
      commissionBps: 20,
      balance: 1_000_000n,
    });
    const victim = await createCustomer({ balance: 500_000n });
    const recipient = await createCustomer();
    const { secret } = await createApiKey(partner.ctx, {
      name: 'Payouts',
      scopes: ['transfers:write'],
    });
    const { ctx } = await authenticateApiKey(`Bearer ${secret}`);

    await expect(
      createTransfer(ctx, {
        senderWalletId: victim.walletId,
        recipient: { kind: 'WALLET', identifier: recipient.phone },
        amount: 10_000n,
        idempotencyKey: idem('api'),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const { transfer } = await createTransfer(ctx, {
      senderWalletId: partner.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.phone },
      amount: 100_000n,
      idempotencyKey: idem('api'),
    });
    expect(transfer).toMatchObject({
      status: 'COMPLETED',
      channel: 'API',
      senderPartnerId: partner.id,
      senderUserId: null,
    });
    // The originating partner earns its rebate (20 bps).
    expect(transfer.commissionAmount).toBe(200n);
    expect(await walletBalance(recipient.walletId)).toBe(100_000n);
    const history = await listMyTransfers(ctx);
    expect(history.items.map((item) => item.reference)).toEqual([transfer.reference]);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'transfer.create', resourceId: transfer.id },
    });
    expect(audit.actorType).toBe('API_KEY');
  });
});

describe('partner webhooks', () => {
  it('delivers signed events, logs every attempt and never leaks the secret', async () => {
    const merchant = await createPartner({ type: 'MERCHANT', commissionBps: 30 });
    const customer = await createCustomer({ balance: 500_000n });
    const { endpoint, secret } = await createWebhookEndpoint(merchant.ctx, {
      url: `${receiverUrl}/hook`,
      events: ['payment.received', 'webhook.test'],
    });
    expect(secret).toMatch(/^whsec_/);
    const row = await db.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } });
    expect(row.secretEnc).toMatch(/^v1\./);
    expect(row.secretEnc).not.toContain(secret);
    expect(JSON.stringify(endpoint)).not.toContain('secret');

    received.length = 0;
    const { transfer } = await createTransfer(customer.ctx, {
      senderWalletId: customer.walletId,
      recipient: { kind: 'WALLET', identifier: merchant.code },
      amount: 40_000n,
      idempotencyKey: idem(),
    });
    expect(received).toHaveLength(1);
    const delivery = received[0]!;
    const verification = verifyWebhookSignature(
      secret,
      delivery.body,
      delivery.headers['x-birem-signature'] as string,
    );
    expect(verification.ok).toBe(true);
    expect(
      verifyWebhookSignature(
        'whsec_other',
        delivery.body,
        delivery.headers['x-birem-signature'] as string,
      ).ok,
    ).toBe(false);
    const event = JSON.parse(delivery.body) as {
      type: string;
      data: { reference: string; receiveAmount: string };
    };
    expect(event).toMatchObject({
      type: 'payment.received',
      data: { reference: transfer.reference, receiveAmount: '40000' },
    });

    const test = await sendTestWebhook(merchant.ctx, endpoint.id);
    expect(test).toMatchObject({
      status: 'DELIVERED',
      responseStatus: 200,
      eventType: 'webhook.test',
    });

    // A failing endpoint is logged as FAILED and does not break the transfer.
    await createWebhookEndpoint(merchant.ctx, {
      url: `${receiverUrl}/fail`,
      events: ['payment.received'],
    });
    const second = await createTransfer(customer.ctx, {
      senderWalletId: customer.walletId,
      recipient: { kind: 'WALLET', identifier: merchant.code },
      amount: 10_000n,
      idempotencyKey: idem(),
    });
    expect(second.transfer.status).toBe('COMPLETED');
    const log = await listWebhookDeliveries(merchant.ctx);
    expect(log.map((entry) => entry.status).sort()).toEqual([
      'DELIVERED',
      'DELIVERED',
      'DELIVERED',
      'FAILED',
    ]);
    expect(log.find((entry) => entry.status === 'FAILED')?.responseStatus).toBe(500);

    // Scoping: another partner sees nothing and cannot test the endpoint.
    const other = await createPartner();
    expect(await listWebhookDeliveries(other.ctx)).toEqual([]);
    await expect(sendTestWebhook(other.ctx, endpoint.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      createWebhookEndpoint(merchant.ctx, { url: 'ftp://example.com/x', events: ['webhook.test'] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});

describe('commissions and settlements', () => {
  it('settles accrued commission into the partner wallet with a balanced journal', async () => {
    const treasury = await createStaff('TREASURY');
    const merchant = await createPartner({ type: 'MERCHANT', commissionBps: 30 });
    const customer = await createCustomer({ balance: 2_000_000n });
    for (const amount of [100_000n, 200_000n, 50_000n]) {
      await createTransfer(customer.ctx, {
        senderWalletId: customer.walletId,
        recipient: { kind: 'WALLET', identifier: merchant.code },
        amount,
        idempotencyKey: idem(),
      });
    }
    // 30 bps of 350 000 = 300 + 600 + 150.
    expect(await getCommissionSummary(merchant.ctx)).toEqual([
      {
        currency: 'XAF',
        accrued: 1_050n,
        accruedCount: 3,
        settled: 0n,
        settledCount: 0,
        reversed: 0n,
      },
    ]);
    const payableBefore = await systemBalance('COMMISSION_PAYABLE', 'XAF');
    const walletBefore = await walletBalance(merchant.walletId);

    await expect(
      createSettlement(merchant.ctx, { partnerId: merchant.id, currency: 'XAF' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const settlement = await createSettlement(treasury.ctx, {
      partnerId: merchant.id,
      currency: 'XAF',
    });
    expect(settlement).toMatchObject({ amount: 1_050n, commissionCount: 3, status: 'PAID' });
    expect(settlement.reference).toMatch(/^SET-\d{4}-/);
    expect((await walletBalance(merchant.walletId)) - walletBefore).toBe(1_050n);
    expect(payableBefore - (await systemBalance('COMMISSION_PAYABLE', 'XAF'))).toBe(1_050n);
    expect((await getCommissionSummary(merchant.ctx))[0]).toMatchObject({
      accrued: 0n,
      settled: 1_050n,
      settledCount: 3,
    });
    await expect(
      createSettlement(treasury.ctx, { partnerId: merchant.id, currency: 'XAF' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect((await verifyLedgerIntegrity()).every((row) => row.balanced)).toBe(true);

    const dashboard = await getPartnerDashboard(merchant.ctx);
    expect(dashboard.last30Days.received).toEqual([
      { currency: 'XAF', count: 3, amount: 350_000n },
    ]);
    expect(dashboard.wallets[0]?.balance).toBe(351_050n);
    const other = await createPartner();
    await expect(getPartnerDashboard(other.ctx, merchant.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('wallets and beneficiaries', () => {
  it('a customer only sees their own wallets, statements and beneficiaries', async () => {
    const owner = await createCustomer({ balance: 300_000n });
    const friend = await createCustomer();
    const stranger = await createCustomer();
    await createTransfer(owner.ctx, {
      senderWalletId: owner.walletId,
      recipient: { kind: 'WALLET', identifier: friend.phone },
      amount: 20_000n,
      idempotencyKey: idem(),
    });

    await expect(getWallet(stranger.ctx, owner.walletId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(getWalletStatement(stranger.ctx, owner.walletId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const statement = await getWalletStatement(owner.ctx, owner.walletId);
    expect(statement.map((line) => line.delta)).toEqual([-20_100n, 300_000n]);
    expect(statement[0]?.balanceAfter).toBe(279_900n);
    const support = await createStaff('SUPPORT');
    expect((await getWallet(support.ctx, owner.walletId)).balance).toBe(279_900n);

    const walletBeneficiary = await createBeneficiary(owner.ctx, {
      fullName: 'My Friend',
      method: 'WALLET',
      accountNumber: friend.email,
    });
    expect(walletBeneficiary).toMatchObject({
      countryCode: 'CM',
      currency: 'XAF',
      accountNumber: friend.email,
    });
    const momo = await createBeneficiary(owner.ctx, {
      fullName: 'Tia Rosa',
      method: 'MOBILE_MONEY',
      accountNumber: '+258 84 123 4567',
      providerId: await providerId('m-pesa-mz'),
    });
    expect(momo).toMatchObject({
      countryCode: 'MZ',
      currency: 'MZN',
      accountNumber: '+258841234567',
    });
    await expect(
      createBeneficiary(owner.ctx, {
        fullName: 'Nobody',
        method: 'WALLET',
        accountNumber: 'ghost@test.local',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createBeneficiary(owner.ctx, {
        fullName: 'Me',
        method: 'WALLET',
        accountNumber: owner.email,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createBeneficiary(owner.ctx, {
        fullName: 'Bad',
        method: 'MOBILE_MONEY',
        accountNumber: '+258840000000',
        providerId: await providerId('m-pesa-mz'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createBeneficiary(owner.ctx, {
        fullName: 'Dup',
        method: 'WALLET',
        accountNumber: friend.email,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Paying a saved beneficiary abroad through mobile money.
    const { transfer } = await createTransfer(owner.ctx, {
      senderWalletId: owner.walletId,
      recipient: { kind: 'BENEFICIARY', beneficiaryId: momo.id },
      amount: 50_000n,
      idempotencyKey: idem(),
      purpose: 'FAMILY_SUPPORT',
      sourceOfFunds: 'SALARY',
    });
    expect(transfer).toMatchObject({
      type: 'INTERNATIONAL',
      status: 'COMPLETED',
      targetCurrency: 'MZN',
      beneficiaryId: momo.id,
    });

    // Someone else's beneficiary id is useless.
    await expect(
      createTransfer(stranger.ctx, {
        senderWalletId: stranger.walletId,
        recipient: { kind: 'BENEFICIARY', beneficiaryId: momo.id },
        amount: 1_000n,
        idempotencyKey: idem(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(archiveBeneficiary(stranger.ctx, momo.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await listBeneficiaries(stranger.ctx)).toEqual([]);
    await archiveBeneficiary(owner.ctx, walletBeneficiary.id);
    expect((await listBeneficiaries(owner.ctx)).map((entry) => entry.id)).toEqual([momo.id]);
  });
});

describe('configuration: fees, FX, countries, treasury', () => {
  it('fee rules and FX overrides need the right permission and are audited', async () => {
    const treasury = await createStaff('TREASURY');
    const support = await createStaff('SUPPORT');
    await expect(
      setFxRate(support.ctx, {
        baseCurrency: 'XAF',
        quoteCurrency: 'CVE',
        midRate: '0.17',
        marginBps: 100,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const [rate, inverse] = await setFxRate(treasury.ctx, {
      baseCurrency: 'xaf',
      quoteCurrency: 'cve',
      midRate: '0.2',
      marginBps: 120,
      updateInverse: true,
    });
    expect(rate).toMatchObject({ source: 'manual', marginBps: 120 });
    expect(rate!.midRate.toFixed(10)).toBe('0.2000000000');
    expect(inverse!.midRate.toFixed(10)).toBe('5.0000000000');
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'fx_rate.override', resourceId: 'XAF/CVE' },
    });
    expect(audit.before).toMatchObject({ source: 'seed' });
    expect(audit.after).toMatchObject({ source: 'manual', marginBps: 120 });
    await expect(
      setFxRate(treasury.ctx, {
        baseCurrency: 'XAF',
        quoteCurrency: 'XAF',
        midRate: '1',
        marginBps: 0,
      }),
    ).rejects.toThrow();

    await expect(
      saveFeeRule(support.ctx, { name: 'x', currency: 'XAF', percentBps: 10 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A corridor-specific rule beats the generic one: CM → GA at 100 bps flat.
    const rule = await saveFeeRule(treasury.ctx, {
      name: 'CM → GA promo',
      transferType: 'INTERNATIONAL',
      currency: 'XAF',
      sourceCountry: 'CM',
      targetCountry: 'GA',
      percentBps: 100,
      maxFee: '500',
    });
    const sender = await createCustomer({ country: 'CM', balance: 500_000n });
    const recipient = await createCustomer({ country: 'GA' });
    const send = () =>
      createTransfer(sender.ctx, {
        senderWalletId: sender.walletId,
        recipient: { kind: 'WALLET', identifier: recipient.phone },
        amount: 100_000n,
        idempotencyKey: idem(),
        purpose: 'GIFT',
        sourceOfFunds: 'SALARY',
      });
    expect((await send()).transfer.feeAmount).toBe(500n); // 1 000 capped at 500
    await setFeeRuleActive(treasury.ctx, rule.id, false);
    expect((await send()).transfer.feeAmount).toBe(2_100n); // back to the seeded rule
  });

  it('a disabled country cannot send or receive', async () => {
    const admin = await createStaff('ADMIN');
    const sender = await createCustomer({ country: 'CM', balance: 500_000n });
    const recipient = await createCustomer({ country: 'ST' });
    const input = () => ({
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET' as const, identifier: recipient.email },
      amount: 10_000n,
      idempotencyKey: idem(),
      purpose: 'GIFT' as const,
      sourceOfFunds: 'SALARY' as const,
    });
    await setCountryEnabled(admin.ctx, 'ST', false);
    await expect(createTransfer(sender.ctx, input())).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
    await setCountryEnabled(admin.ctx, 'ST', true);
    expect((await createTransfer(sender.ctx, input())).transfer.status).toBe('COMPLETED');
    await expect(setCountryEnabled(sender.ctx, 'ST', false)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('float funding and thresholds drive the liquidity alerts', async () => {
    const treasury = await createStaff('TREASURY');
    const support = await createStaff('SUPPORT');
    await expect(
      moveFloat(support.ctx, {
        currency: 'STN',
        amount: 1_000n,
        direction: 'FUND',
        reason: 'not allowed',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await setTreasuryThreshold(treasury.ctx, {
      currency: 'STN',
      lowBalance: '500000',
      criticalBalance: '100000',
    });
    const position = async () =>
      (await getTreasuryDashboard(treasury.ctx)).positions.find((row) => row.currency === 'STN')!;
    expect((await position()).liquidity).toBe('CRITICAL');
    await moveFloat(treasury.ctx, {
      currency: 'STN',
      amount: 300_000n,
      direction: 'FUND',
      reason: 'Initial float at the bank',
    });
    expect(await position()).toMatchObject({
      float: 300_000n,
      liquidity: 'LOW',
      capital: 300_000n,
    });
    await moveFloat(treasury.ctx, {
      currency: 'STN',
      amount: 400_000n,
      direction: 'FUND',
      reason: 'Second tranche',
    });
    expect((await position()).liquidity).toBe('OK');
    await expect(
      moveFloat(treasury.ctx, {
        currency: 'STN',
        amount: 900_000n,
        direction: 'WITHDRAW',
        reason: 'Too much to take',
      }),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect((await verifyLedgerIntegrity()).every((row) => row.balanced)).toBe(true);
  });
});

describe('reports, exports and receipts', () => {
  it('dashboards add up and respect permissions', async () => {
    const admin = await createStaff('ADMIN');
    const customer = await createCustomer({ balance: 3_000_000n });
    const abroad = await createCustomer({ country: 'AO' });
    await createTransfer(customer.ctx, {
      senderWalletId: customer.walletId,
      recipient: { kind: 'WALLET', identifier: abroad.email },
      amount: 300_000n,
      idempotencyKey: idem(),
      purpose: 'FAMILY_SUPPORT',
      sourceOfFunds: 'SALARY',
    });
    const range = resolveRange({ days: 7 });
    const [executive, operations, revenue, compliance, treasury, reconciliation] =
      await Promise.all([
        getExecutiveDashboard(admin.ctx, range),
        getOperationalDashboard(admin.ctx, range),
        getRevenueDashboard(admin.ctx, range),
        getComplianceDashboard(admin.ctx, range),
        getTreasuryDashboard(admin.ctx, range),
        getReconciliation(admin.ctx),
      ]);
    expect(executive.totals.completed).toBeGreaterThanOrEqual(1);
    expect(executive.totals.valueUsd).toBeGreaterThan(0n);
    expect(executive.daily.reduce((sum, day) => sum + day.completed, 0)).toBe(
      executive.totals.completed,
    );
    expect(executive.daily.reduce((sum, day) => sum + day.revenueUsd, 0n)).toBe(
      executive.totals.revenueUsd,
    );
    expect(
      executive.corridors.some(
        (corridor) => corridor.sourceCountry === 'CM' && corridor.targetCountry === 'AO',
      ),
    ).toBe(true);
    expect(executive.activeUsers.mau).toBeGreaterThanOrEqual(1);
    expect(operations.byStatus.reduce((sum, row) => sum + row.count, 0)).toBeGreaterThanOrEqual(
      operations.totals.transfers,
    );
    expect(operations.providers.length).toBeGreaterThan(10);
    // Fees + FX margin = revenue (within the integer split of each transfer).
    expect(revenue.totals.feeUsd + revenue.totals.fxMarginUsd).toBe(revenue.totals.revenueUsd);
    expect(revenue.totals.fxMarginUsd).toBeGreaterThan(0n);
    expect(revenue.byCurrency.find((row) => row.currency === 'XAF')?.fxMargin).toBeGreaterThan(0n);
    expect(compliance.kyc.byStatus.length).toBeGreaterThan(0);
    expect(
      treasury.fxPairs.some(
        (pair) => pair.sourceCurrency === 'XAF' && pair.targetCurrency === 'AOA',
      ),
    ).toBe(true);
    expect(treasury.integrity.every((row) => row.balanced)).toBe(true);
    expect(reconciliation.healthy).toBe(true);

    await expect(getExecutiveDashboard(customer.ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const support = await createStaff('SUPPORT');
    await expect(getTreasuryDashboard(support.ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(exportReport(support.ctx, 'transfers', 'csv')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('exports CSV, Excel and PDF and audits each export', async () => {
    const admin = await createStaff('ADMIN');
    const customer = await createCustomer({ balance: 500_000n, fullName: '=cmd|calc Évil Ñame' });
    const friend = await createCustomer();
    await createTransfer(customer.ctx, {
      senderWalletId: customer.walletId,
      recipient: { kind: 'WALLET', identifier: friend.phone },
      amount: 10_000n,
      idempotencyKey: idem(),
    });

    const csv = await exportReport(admin.ctx, 'transfers', 'csv');
    const text = new TextDecoder().decode(csv.data);
    expect(csv.contentType).toContain('text/csv');
    expect(csv.fileName).toMatch(/^bi-rem-transfers-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(text.split('\r\n')[0]).toContain('Reference');
    // Formula injection is neutralised.
    expect(text).toContain("'=cmd|calc Évil Ñame");
    expect(text).not.toMatch(/(^|,)=cmd/m);

    const xlsx = await exportReport(admin.ctx, 'revenue', 'xlsx');
    expect(Buffer.from(xlsx.data.subarray(0, 2)).toString()).toBe('PK');
    const pdf = await exportReport(admin.ctx, 'transfers', 'pdf');
    expect(Buffer.from(pdf.data.subarray(0, 5)).toString()).toBe('%PDF-');
    for (const name of [
      'corridors',
      'providers',
      'compliance',
      'treasury',
      'commissions',
      'audit',
    ] as const) {
      const file = await exportReport(admin.ctx, name, 'pdf');
      expect(file.data.byteLength).toBeGreaterThan(500);
    }
    await expect(exportReport(admin.ctx, 'secrets', 'csv')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(exportReport(admin.ctx, 'transfers', 'exe')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(await db.auditLog.count({ where: { action: 'report.export' } })).toBe(9);
  });

  it('receipts are available to the parties only', async () => {
    const sender = await createCustomer({ country: 'CM', balance: 800_000n });
    const recipient = await createCustomer({ country: 'AO' });
    const stranger = await createCustomer();
    const { transfer } = await createTransfer(sender.ctx, {
      senderWalletId: sender.walletId,
      recipient: { kind: 'WALLET', identifier: recipient.email },
      amount: 100_000n,
      idempotencyKey: idem(),
      purpose: 'EDUCATION',
      sourceOfFunds: 'SALARY',
    });
    const receipt = await getReceipt(sender.ctx, transfer.id);
    const lines = receipt.sections.flatMap((section) => section.lines);
    expect(lines.find((line) => line.label === 'Total paid')?.value).toBe('102\u202f100 XAF');
    expect(lines.find((line) => line.label === 'Exchange rate')?.value).toBe(
      '1 XAF = 1.4753444204 AOA',
    );
    expect(lines.find((line) => line.label === 'Purpose')?.value).toBe('Education');

    const theirs = await getReceipt(recipient.ctx, transfer.reference);
    const theirLines = theirs.sections
      .flatMap((section) => section.lines)
      .map((line) => line.label);
    expect(theirLines).toContain('Amount received');
    expect(theirLines).not.toContain('Fee');
    expect(theirLines).not.toContain('Purpose');

    const pdf = await getReceiptPdf(sender.ctx, transfer.id);
    expect(pdf.fileName).toBe(`bi-rem-receipt-${transfer.reference}.pdf`);
    expect(Buffer.from(pdf.data.subarray(0, 5)).toString()).toBe('%PDF-');
    await expect(getReceiptPdf(stranger.ctx, transfer.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('audit log', () => {
  it('records denied and failed actions, redacts secrets and is readable only with audit:read', async () => {
    const admin = await createStaff('ADMIN');
    const support = await createStaff('SUPPORT');
    await expect(
      withAudit(support.ctx, { action: 'demo.forbidden', resourceType: 'demo' }, () =>
        setCountryEnabled(support.ctx, 'CM', false),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await withAudit(
      admin.ctx,
      {
        action: 'demo.secretive',
        resourceType: 'demo',
        metadata: { password: 'hunter2', nested: { apiKey: 'abc', ok: 1n } },
      },
      () => Promise.resolve({ id: 'x1' }),
      (result) => ({ resourceId: result.id, after: { token: 'tok_123', visible: true } }),
    );
    const denied = await db.auditLog.findFirstOrThrow({ where: { action: 'demo.forbidden' } });
    expect(denied.outcome).toBe('DENIED');
    const secretive = await db.auditLog.findFirstOrThrow({ where: { action: 'demo.secretive' } });
    expect(secretive.metadata).toEqual({
      password: '[redacted]',
      nested: { apiKey: '[redacted]', ok: '1' },
    });
    expect(secretive.after).toEqual({ token: '[redacted]', visible: true });
    expect(secretive.resourceId).toBe('x1');

    await expect(listAuditLogs(support.ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const page = await listAuditLogs(admin.ctx, { action: 'demo.', pageSize: 10 });
    expect(page.total).toBe(2);
  });
});
