import { describe, expect, it } from 'vitest';

import { jaroWinkler, nameSimilarity, normalizeName } from '@/server/aml/names';
import { riskLevelForScore } from '@/server/aml/engine';
import { toAuditJson } from '@/server/audit';
import {
  SIMULATOR_SCENARIOS,
  SimulatorConnector,
  simulatedOutcome,
} from '@/server/connectors/simulator';
import { ConnectorTimeoutError } from '@/server/connectors/types';
import { calculateFee } from '@/server/fees';
import { selectKycVendor, getKycProvider, KYC_VENDORS } from '@/server/kyc/vendors';
import { sniffDocumentType } from '@/server/kyc/service';
import { isPrivateAddress, parseOutboundUrl } from '@/server/net-guard';
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  assertPermission,
  canAccessPath,
  hasPermission,
  homePathForRole,
  roleHasPermission,
  systemContext,
  type ActionContext,
} from '@/server/rbac';
import { csvCell, pdfSafe, toCsv, toPdf, toXlsx } from '@/server/reports/exports';
import { resolveRange } from '@/server/reports/dashboards';
import { seedMidRate } from '@/server/seed/reference';
import { settlementLines } from '@/server/transfers/engine';
import { liquidityLevel } from '@/server/treasury';

describe('fee calculation', () => {
  const rule = (overrides: Partial<Parameters<typeof calculateFee>[0]> = {}) => ({
    id: null,
    fixedAmount: 0n,
    percentBps: 0,
    minFee: null,
    maxFee: null,
    ...overrides,
  });

  it('adds fixed and percentage parts', () => {
    expect(calculateFee(rule({ fixedAmount: 600n, percentBps: 150 }), 250_000n)).toBe(4_350n);
    expect(calculateFee(rule({ percentBps: 50 }), 100_000n)).toBe(500n);
    expect(calculateFee(rule(), 100_000n)).toBe(0n);
  });

  it('applies the minimum and the cap', () => {
    expect(calculateFee(rule({ percentBps: 50, minFee: 60n }), 1_000n)).toBe(60n);
    expect(calculateFee(rule({ percentBps: 50, maxFee: 3_000n }), 10_000_000n)).toBe(3_000n);
    expect(
      calculateFee(
        rule({ fixedAmount: 100n, percentBps: 100, minFee: 200n, maxFee: 500n }),
        20_000n,
      ),
    ).toBe(300n);
    expect(calculateFee(rule({ fixedAmount: 100n }), 0n)).toBe(0n);
  });

  it('rounds half up on the percentage', () => {
    expect(calculateFee(rule({ percentBps: 150 }), 1_234_567n)).toBe(18_519n); // 18 518.505
    expect(calculateFee(rule({ percentBps: 1 }), 4_999n)).toBe(0n);
    expect(calculateFee(rule({ percentBps: 1 }), 5_000n)).toBe(1n);
  });
});

describe('settlement journal lines', () => {
  const accounts = {
    sender: 'sender',
    suspense: 'suspense',
    feeRevenue: 'fee',
    fxRevenue: 'fxrev',
    fxPositionSource: 'pos-src',
    fxPositionTarget: 'pos-tgt',
    destination: 'dest',
    commissionExpense: 'cexp',
    commissionPayable: 'cpay',
  };
  const totals = (lines: ReturnType<typeof settlementLines>, ids: string[]) => {
    const pick = lines.filter((line) => ids.includes(line.accountId));
    const sum = (direction: 'DEBIT' | 'CREDIT') =>
      pick
        .filter((line) => line.direction === direction)
        .reduce((total, line) => total + line.amount, 0n);
    return { debit: sum('DEBIT'), credit: sum('CREDIT') };
  };

  it('same currency: one balanced leg', () => {
    const lines = settlementLines(
      {
        sourceCurrency: 'XAF',
        targetCurrency: 'XAF',
        sendAmount: 100_000n,
        feeAmount: 500n,
        fxMarginAmount: 0n,
        totalDebit: 100_500n,
        receiveAmount: 100_000n,
      },
      'sender',
      accounts,
    );
    expect(lines).toEqual([
      { accountId: 'sender', direction: 'DEBIT', amount: 100_500n },
      { accountId: 'fee', direction: 'CREDIT', amount: 500n },
      { accountId: 'dest', direction: 'CREDIT', amount: 100_000n },
    ]);
  });

  it('cross currency: two legs, each balanced, for any amounts', () => {
    for (const [send, fee, margin, receive] of [
      [250_000n, 4_350n, 4_375n, 36_883_610n],
      [1n, 0n, 0n, 1n],
      [100n, 600n, 2n, 147n],
      [57n, 0n, 1n, 84n],
    ] as const) {
      const lines = settlementLines(
        {
          sourceCurrency: 'XAF',
          targetCurrency: 'AOA',
          sendAmount: send,
          feeAmount: fee,
          fxMarginAmount: margin,
          totalDebit: send + fee,
          receiveAmount: receive,
        },
        'suspense',
        accounts,
      );
      expect(lines.every((line) => line.amount > 0n)).toBe(true);
      const source = totals(lines, ['suspense', 'fee', 'fxrev', 'pos-src']);
      const target = totals(lines, ['pos-tgt', 'dest']);
      expect(source.debit).toBe(send + fee);
      expect(source.credit).toBe(send + fee);
      expect(target.debit).toBe(receive);
      expect(target.credit).toBe(receive);
    }
  });
});

describe('seed FX table', () => {
  it('keeps the CFA peg and derives consistent cross rates', () => {
    expect(seedMidRate('EUR', 'XAF')).toBe(6_559_570_000_000n);
    expect(seedMidRate('EUR', 'XOF')).toBe(6_559_570_000_000n);
    expect(seedMidRate('XAF', 'XOF')).toBe(10_000_000_000n);
    expect(seedMidRate('XAF', 'AOA')).toBe(15_016_228_198n);
    expect(seedMidRate('AOA', 'XAF')).toBe(6_659_461_929n);
    expect(seedMidRate('XAF', 'USD')).toBe(16_464_494n); // 1.08 / 655.957
  });
});

describe('name matching', () => {
  it('normalises case, accents and punctuation', () => {
    expect(normalizeName('  José-María  O’Brien ')).toBe('jose maria o brien');
    expect(normalizeName('ÀÉÎÕÜ ç')).toBe('aeiou c');
    expect(normalizeName('...')).toBe('');
  });

  it('scores identical, reordered and misspelt names high', () => {
    expect(nameSimilarity('Viktor Demo Sanctionov', 'viktor demo sanctionov')).toBe(100);
    expect(nameSimilarity('Sanctionov Viktor Demo', 'Viktor Demo Sanctionov')).toBe(100);
    expect(
      nameSimilarity('Viktor Demo Sanctionof', 'Viktor Demo Sanctionov'),
    ).toBeGreaterThanOrEqual(95);
    expect(nameSimilarity('Viktor Sanctionov', 'Viktor Demo Sanctionov')).toBeGreaterThanOrEqual(
      88,
    );
    expect(nameSimilarity('Ministro Sample', 'Sample Ministro')).toBe(100);
  });

  it('keeps unrelated or partial names below the threshold', () => {
    expect(nameSimilarity('Victor Hugo', 'Viktor Demo Sanctionov')).toBeLessThan(88);
    expect(nameSimilarity('Viktor', 'Viktor Demo Sanctionov')).toBeLessThan(88);
    expect(nameSimilarity('Amina Njoya', 'Paula Exemplo Governadora')).toBeLessThan(70);
    expect(nameSimilarity('', 'Someone')).toBe(0);
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.9611, 3);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });

  it('maps risk scores to levels', () => {
    expect([0, 29, 30, 59, 60, 100].map(riskLevelForScore)).toEqual([
      'LOW',
      'LOW',
      'MEDIUM',
      'MEDIUM',
      'HIGH',
      'HIGH',
    ]);
  });
});

describe('simulator connector', () => {
  const connector = new SimulatorConnector({
    code: 'mtn-momo-cm',
    currency: 'XAF',
    name: 'MTN MoMo CM',
  });
  const request = (accountNumber: string) => ({
    reference: 'BRTEST000001',
    direction: 'PAYOUT' as const,
    accountNumber,
    amount: 1_000n,
    currency: 'XAF',
  });

  it('is deterministic by account suffix', async () => {
    expect(simulatedOutcome('+237 670 00 00 01')).toBe('LIMIT_EXCEEDED');
    expect(simulatedOutcome('+237670123456')).toBe('SUCCESS');
    expect(new Set(SIMULATOR_SCENARIOS.map((scenario) => scenario.suffix)).size).toBe(8);

    const success = await connector.transfer(request('+237670123456'));
    expect(success).toEqual(await connector.transfer(request('+237670123456')));
    expect(success.status).toBe('SUCCESS');
    expect(success.providerRef).toMatch(/^SIM-MTN-MOMO-CM-[0-9A-F]{12}$/);

    expect(await connector.transfer(request('+237670000001'))).toMatchObject({
      status: 'FAILED',
      failureCode: 'RECIPIENT_LIMIT_EXCEEDED',
    });
    expect(await connector.transfer(request('+237670000002'))).toMatchObject({
      status: 'FAILED',
      failureCode: 'ACCOUNT_BLOCKED',
    });
    expect((await connector.transfer(request('+237670000003'))).status).toBe('PENDING');
    await expect(connector.transfer(request('+237670000005'))).rejects.toBeInstanceOf(
      ConnectorTimeoutError,
    );
  });

  it('resolves pending outcomes on status checks', async () => {
    const status = (accountNumber: string) =>
      connector.getStatus({ reference: 'BRTEST000001', accountNumber });
    expect((await status('+237670000003')).status).toBe('SUCCESS');
    expect(await status('+237670000004')).toMatchObject({
      status: 'FAILED',
      failureCode: 'PROVIDER_REJECTED',
    });
    expect((await status('+237670000005')).status).toBe('SUCCESS');
    expect((await status('+237670000006')).status).toBe('PENDING');
    // Same reference → same provider reference as the original transfer call.
    expect((await status('+237670123456')).providerRef).toBe(
      (await connector.transfer(request('+237670123456'))).providerRef,
    );
  });

  it('validates accounts, reverses and pings', async () => {
    expect(
      await connector.validateAccount({ accountNumber: '+237670123456', currency: 'XAF' }),
    ).toMatchObject({ valid: true });
    expect(
      (await connector.validateAccount({ accountNumber: '+237670000000', currency: 'XAF' })).valid,
    ).toBe(false);
    expect((await connector.validateAccount({ accountNumber: '123', currency: 'XAF' })).valid).toBe(
      false,
    );
    expect(
      (await connector.validateAccount({ accountNumber: '+237670123456', currency: 'AOA' })).valid,
    ).toBe(false);
    const reverse = { reference: 'BRTEST000001', amount: 1_000n, currency: 'XAF', reason: 'test' };
    expect((await connector.reverse({ ...reverse, accountNumber: '+237670123456' })).status).toBe(
      'SUCCESS',
    );
    expect(await connector.reverse({ ...reverse, accountNumber: '+237670000007' })).toMatchObject({
      status: 'FAILED',
      failureCode: 'REVERSAL_NOT_ALLOWED',
    });
    const ping = await connector.ping();
    expect(ping.ok).toBe(true);
    expect(ping.message).toMatch(/no real operator/i);
    expect(connector.simulated).toBe(true);
    expect(await connector.getBalance()).toEqual({ currency: 'XAF', available: 10_000_000n });
  });
});

describe('KYC vendors (simulated)', () => {
  it('routes by document and country and always says it is simulated', async () => {
    expect(selectKycVendor('PASSPORT', 'CM')).toBe('veriff');
    expect(selectKycVendor('NATIONAL_ID', 'AO')).toBe('sumsub');
    expect(selectKycVendor('NATIONAL_ID', 'CM')).toBe('smile_identity');
    expect(selectKycVendor('VOTER_CARD', 'GA', 'veriff')).toBe('veriff');
    expect(KYC_VENDORS.every((vendor) => vendor.simulated && /simulated/i.test(vendor.name))).toBe(
      true,
    );

    const base = {
      caseId: 'case-1',
      fullName: 'Test',
      idType: 'NATIONAL_ID',
      idCountry: 'CM',
      documents: [{ kind: 'ID_FRONT', sha256: 'x', size: 1, mimeType: 'image/png' }],
    };
    const vendor = getKycProvider('smile_identity');
    expect(await vendor.verify({ ...base, idNumber: 'CM-123' })).toMatchObject({
      decision: 'APPROVE',
      simulated: true,
    });
    expect((await vendor.verify({ ...base, idNumber: 'CM-0000' })).decision).toBe('REJECT');
    expect((await vendor.verify({ ...base, idNumber: 'CM-9999' })).decision).toBe('REVIEW');
    expect((await vendor.verify({ ...base, idNumber: 'cm-review-1' })).decision).toBe('REVIEW');
    expect((await vendor.verify({ ...base, idNumber: 'CM-123', documents: [] })).decision).toBe(
      'REVIEW',
    );
    expect(await vendor.verify({ ...base, idNumber: 'CM-123' })).toEqual(
      await vendor.verify({ ...base, idNumber: 'CM-123' }),
    );
  });

  it('sniffs document types from magic bytes', () => {
    expect(sniffDocumentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffDocumentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(sniffDocumentType(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffDocumentType(new TextEncoder().encode('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffDocumentType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffDocumentType(new Uint8Array())).toBeNull();
  });
});

describe('RBAC', () => {
  const user = (
    role: Parameters<typeof homePathForRole>[0],
    partnerId: string | null = null,
  ): ActionContext => ({
    actor: { type: 'USER', id: 'u1', role, label: 'x@test.local', partnerId },
  });

  it('gives admins every back-office permission and nobody else too much', () => {
    for (const permission of PERMISSIONS) {
      const expected = permission !== 'customer:access' && permission !== 'partner:access';
      expect(roleHasPermission('ADMIN', permission), permission).toBe(expected);
    }
    expect(ROLE_PERMISSIONS.CUSTOMER).toEqual(['customer:access']);
    expect(ROLE_PERMISSIONS.PARTNER).toEqual(['partner:access']);
    expect(roleHasPermission('COMPLIANCE', 'aml:write')).toBe(true);
    expect(roleHasPermission('COMPLIANCE', 'fx:write')).toBe(false);
    expect(roleHasPermission('COMPLIANCE', 'transfers:reverse')).toBe(false);
    expect(roleHasPermission('TREASURY', 'fx:write')).toBe(true);
    expect(roleHasPermission('TREASURY', 'aml:write')).toBe(false);
    expect(roleHasPermission('TREASURY', 'kyc:review')).toBe(false);
    expect(roleHasPermission('SUPPORT', 'users:read')).toBe(true);
    for (const permission of [
      'users:write',
      'providers:write',
      'fx:write',
      'aml:write',
      'kyc:review',
      'audit:read',
      'reports:export',
      'settings:write',
    ] as const) {
      expect(roleHasPermission('SUPPORT', permission), permission).toBe(false);
    }
  });

  it('asserts permissions per actor type', () => {
    expect(() => assertPermission(user('SUPPORT'), 'fx:write')).toThrow(
      /Missing permission fx:write/,
    );
    expect(() => assertPermission(user('TREASURY'), 'fx:write')).not.toThrow();
    expect(hasPermission(systemContext(), 'settings:write')).toBe(true);
    const apiKey: ActionContext = {
      actor: { type: 'API_KEY', id: 'k1', partnerId: 'p1', label: 'key', scopes: [] },
    };
    expect(hasPermission(apiKey, 'partner:access')).toBe(true);
    expect(hasPermission(apiKey, 'transfers:read')).toBe(false);
  });

  it('routes each role to its own area only', () => {
    expect(homePathForRole('CUSTOMER')).toBe('/app');
    expect(homePathForRole('PARTNER')).toBe('/partner');
    for (const role of ['ADMIN', 'COMPLIANCE', 'TREASURY', 'SUPPORT'] as const)
      expect(homePathForRole(role)).toBe('/admin');
    expect(canAccessPath('CUSTOMER', '/app/transfers')).toBe(true);
    expect(canAccessPath('CUSTOMER', '/admin')).toBe(false);
    expect(canAccessPath('CUSTOMER', '/partner/keys')).toBe(false);
    expect(canAccessPath('PARTNER', '/partner')).toBe(true);
    expect(canAccessPath('PARTNER', '/app')).toBe(false);
    expect(canAccessPath('SUPPORT', '/admin/users')).toBe(true);
    expect(canAccessPath('ADMIN', '/app')).toBe(false);
    expect(canAccessPath('CUSTOMER', '/application')).toBe(true);
    expect(canAccessPath('CUSTOMER', '/roadmap')).toBe(true);
  });
});

describe('exports', () => {
  const table = {
    title: 'Test report',
    subtitle: 'unit',
    generatedAt: new Date('2026-11-10T10:00:00Z'),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'amount', label: 'Amount', align: 'right' as const },
    ],
    rows: [
      { name: 'Plain', amount: 12n },
      { name: 'Comma, "quoted"\nline', amount: 1_234_567_890_123_456_789n },
      { name: '=HYPERLINK("http://evil")', amount: -5 },
      { name: null, amount: null },
    ],
  };

  it('writes RFC 4180 CSV and defuses formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(12n)).toBe('12');
    expect(csvCell(null)).toBe('');
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(toCsv(table));
    expect(text.startsWith('\ufeffName,Amount\r\n')).toBe(true);
    expect(text).toContain('"Comma, ""quoted""\nline",1234567890123456789\r\n');
    expect(text).toContain('"\'=HYPERLINK(""http://evil"")",-5');
    expect(text.endsWith(',\r\n')).toBe(true);
  });

  it('renders Excel and PDF, including characters outside WinAnsi', async () => {
    const xlsx = await toXlsx(table);
    expect(Buffer.from(xlsx.subarray(0, 2)).toString()).toBe('PK');
    const odd = {
      ...table,
      rows: [
        { name: 'Ngũgĩ → 中文 ₦ “quotes” – dash…', amount: 1n },
        ...Array.from({ length: 80 }, (_, index) => ({
          name: `Row ${index}`,
          amount: BigInt(index),
        })),
      ],
    };
    const pdf = await toPdf(odd);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(pdfSafe('a\u202fb → “c” – d… ₦ é')).toBe('a b -> "c" - d... ? é');
  });
});

describe('small helpers', () => {
  it('resolveRange handles days and explicit dates', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(resolveRange({ days: 7 }, now)).toEqual({
      from: new Date('2026-11-03T12:00:00Z'),
      to: now,
    });
    expect(resolveRange({ days: 'abc' }, now).from).toEqual(new Date('2026-10-11T12:00:00Z'));
    expect(resolveRange({ days: 100_000 }, now).from).toEqual(new Date('2026-10-11T12:00:00Z'));
    expect(resolveRange({ from: '2026-10-01', to: '2026-10-31' }, now)).toEqual({
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-31T23:59:59.999Z'),
    });
    expect(resolveRange({ from: '2026-10-31', to: '2026-10-01' }, now).to).toEqual(now);
    expect(resolveRange({ from: "2026-10-01'; DROP", to: '2026-10-31' }, now).to).toEqual(now);
  });

  it('liquidityLevel compares against thresholds', () => {
    const threshold = { lowBalance: 1_000n, criticalBalance: 200n };
    expect(liquidityLevel(5_000n, threshold)).toBe('OK');
    expect(liquidityLevel(1_000n, threshold)).toBe('LOW');
    expect(liquidityLevel(200n, threshold)).toBe('CRITICAL');
    expect(liquidityLevel(-50n, threshold)).toBe('CRITICAL');
    expect(liquidityLevel(0n, null)).toBe('OK');
  });

  it('toAuditJson redacts sensitive keys at any depth', () => {
    expect(
      toAuditJson({
        email: 'a@b.c',
        passwordHash: 'x',
        nested: { webhookSecret: 's', list: [{ apiKey: 'k', amount: 5n }] },
        when: new Date(0),
        blob: new Uint8Array(2),
      }),
    ).toEqual({
      email: 'a@b.c',
      passwordHash: '[redacted]',
      nested: { webhookSecret: '[redacted]', list: [{ apiKey: '[redacted]', amount: '5' }] },
      when: '1970-01-01T00:00:00.000Z',
      blob: '[binary]',
    });
    expect(toAuditJson(undefined)).toBeNull();
  });

  it('net guard recognises private addresses and bad URLs', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of [
      '8.8.8.8',
      '172.32.0.1',
      '1.1.1.1',
      '2606:4700:4700::1111',
      'example.com',
    ]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
    expect(parseOutboundUrl('https://api.example.com/v1').hostname).toBe('api.example.com');
    for (const bad of [
      'notaurl',
      'ftp://example.com',
      'javascript:alert(1)',
      'https://user:pass@example.com',
      'file:///etc/passwd',
    ]) {
      expect(() => parseOutboundUrl(bad), bad).toThrow();
    }
  });
});
