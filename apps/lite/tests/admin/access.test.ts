import { describe, expect, it } from 'vitest';

import {
  checkbox,
  dayEnd,
  dayStart,
  enumParam,
  flattenParams,
  hrefWith,
  pageParam,
  percentBps,
  uuidParam,
} from '@/components/admin/helpers';
import { adminNavFor } from '@/components/shell/nav';
import { listAuditLogs } from '@/server/audit';
import { releaseCase } from '@/server/aml';
import { createProvider, testProviderConnectivity } from '@/server/connectors';
import { setCountryEnabled } from '@/server/countries';
import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { reviewKycCase } from '@/server/kyc';
import { STAFF_ROLES, type StaffRole } from '@/server/rbac';
import { exportReport, getTreasuryDashboard, resolveRange } from '@/server/reports';
import { createTransfer, reverseTransfer } from '@/server/transfers';
import { moveFloat, setTreasuryThreshold } from '@/server/treasury';
import { createStaffUser, setUserStatus } from '@/server/users';

import { withTestDatabase } from '../helpers/db';
import { createCustomer, createStaff, idem, providerId } from '../helpers/factories';

withTestDatabase();

const code = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    return error instanceof AppError ? error.code : `unexpected: ${String(error)}`;
  }
  return 'ok';
};

describe('back-office navigation per role', () => {
  const hrefs = (role: StaffRole): string[] => adminNavFor(role).map((item) => item.href);

  it('shows every section to administrators', () => {
    expect(hrefs('ADMIN')).toEqual([
      '/admin',
      '/admin/transfers',
      '/admin/notifications',
      '/admin/customers',
      '/admin/kyc',
      '/admin/compliance',
      '/admin/audit',
      '/admin/providers',
      '/admin/countries',
      '/admin/fees',
      '/admin/fx',
      '/admin/treasury',
      '/admin/partners',
      '/admin/reports',
      '/admin/users',
      '/admin/settings',
      '/admin/security',
    ]);
  });

  it('hides what a role cannot open', () => {
    const compliance = hrefs('COMPLIANCE');
    expect(compliance).toEqual(
      expect.arrayContaining([
        '/admin/kyc',
        '/admin/compliance',
        '/admin/customers',
        '/admin/audit',
      ]),
    );
    expect(compliance).not.toEqual(expect.arrayContaining(['/admin/treasury']));
    expect(compliance).not.toContain('/admin/users');
    expect(compliance).not.toContain('/admin/settings');

    const treasury = hrefs('TREASURY');
    expect(treasury).toEqual(
      expect.arrayContaining(['/admin/fx', '/admin/treasury', '/admin/fees', '/admin/reports']),
    );
    expect(treasury).not.toContain('/admin/compliance');
    expect(treasury).not.toContain('/admin/audit');
    expect(treasury).not.toContain('/admin/users');

    const support = hrefs('SUPPORT');
    expect(support).toEqual(
      expect.arrayContaining(['/admin/customers', '/admin/transfers', '/admin/notifications']),
    );
    expect(support).not.toContain('/admin/treasury');
    expect(support).not.toContain('/admin/audit');
    expect(support).not.toContain('/admin/users');
  });

  it('never links a staff role to the customer or partner areas', () => {
    for (const role of STAFF_ROLES) {
      expect(hrefs(role).every((href) => href === '/admin' || href.startsWith('/admin/'))).toBe(
        true,
      );
    }
  });
});

describe('server-side authorisation of back-office mutations', () => {
  it('enforces the role matrix in the services, whatever the page shows', async () => {
    const [admin, compliance, treasury, support] = await Promise.all([
      createStaff('ADMIN'),
      createStaff('COMPLIANCE'),
      createStaff('TREASURY'),
      createStaff('SUPPORT'),
    ]);
    const customer = await createCustomer({ balance: 100_000n });
    const anyId = '00000000-0000-4000-8000-000000000000';
    const mtn = await providerId('mtn-momo-cm');

    // KYC decisions: compliance and admin only.
    for (const staff of [treasury, support]) {
      expect(
        await code(() =>
          reviewKycCase(staff.ctx, anyId, { decision: 'APPROVE', note: 'looks fine' }),
        ),
      ).toBe('FORBIDDEN');
    }
    expect(
      await code(() =>
        reviewKycCase(compliance.ctx, anyId, { decision: 'APPROVE', note: 'looks fine' }),
      ),
    ).toBe('NOT_FOUND');

    // Held transfers: compliance and admin only.
    for (const staff of [treasury, support]) {
      expect(await code(() => releaseCase(staff.ctx, anyId, 'Cleared after review'))).toBe(
        'FORBIDDEN',
      );
    }

    // Treasury: treasury and admin only.
    for (const staff of [compliance, support]) {
      expect(
        await code(() =>
          moveFloat(staff.ctx, {
            currency: 'XAF',
            amount: 1_000n,
            direction: 'FUND',
            reason: 'Top up float',
          }),
        ),
      ).toBe('FORBIDDEN');
      expect(
        await code(() =>
          setTreasuryThreshold(staff.ctx, {
            currency: 'XAF',
            lowBalance: '10',
            criticalBalance: '5',
          }),
        ),
      ).toBe('FORBIDDEN');
      expect(await code(() => getTreasuryDashboard(staff.ctx))).toBe('FORBIDDEN');
    }
    expect(
      await code(() =>
        moveFloat(treasury.ctx, {
          currency: 'XAF',
          amount: 1_000n,
          direction: 'FUND',
          reason: 'Top up float',
        }),
      ),
    ).toBe('ok');

    // Administrator-only: providers, countries, staff, account status, reversals.
    const { transfer } = await createTransfer(customer.ctx, {
      senderWalletId: customer.walletId,
      recipient: {
        kind: 'MOBILE_MONEY',
        providerId: mtn,
        accountNumber: '+237670001234',
        name: 'Rec',
      },
      amount: 5_000n,
      idempotencyKey: idem('access'),
    });
    for (const staff of [compliance, treasury, support]) {
      expect(await code(() => testProviderConnectivity(staff.ctx, mtn))).toBe('FORBIDDEN');
      expect(
        await code(() =>
          createProvider(staff.ctx, {
            code: 'rogue-provider',
            name: 'Rogue',
            operator: 'Rogue',
            countryCode: 'CM',
            currency: 'XAF',
            adapter: 'simulator',
            environment: 'SANDBOX',
          }),
        ),
      ).toBe('FORBIDDEN');
      expect(await code(() => setCountryEnabled(staff.ctx, 'NG', true))).toBe('FORBIDDEN');
      expect(
        await code(() =>
          createStaffUser(staff.ctx, {
            email: 'new@test.local',
            fullName: 'New Person',
            role: 'ADMIN',
            password: 'LongEnough123',
          }),
        ),
      ).toBe('FORBIDDEN');
      expect(await code(() => setUserStatus(staff.ctx, customer.id, 'SUSPENDED', 'Because'))).toBe(
        'FORBIDDEN',
      );
      expect(await code(() => reverseTransfer(staff.ctx, transfer.id, 'Operator error'))).toBe(
        'FORBIDDEN',
      );
    }
    expect(await db.provider.count({ where: { code: 'rogue-provider' } })).toBe(0);
    expect((await db.country.findUniqueOrThrow({ where: { code: 'NG' } })).enabled).toBe(false);

    // The audit log: administrators and compliance.
    for (const staff of [treasury, support]) {
      expect(await code(() => listAuditLogs(staff.ctx))).toBe('FORBIDDEN');
    }
    expect(await code(() => listAuditLogs(compliance.ctx))).toBe('ok');

    // An administrator cannot suspend their own account.
    expect(
      await code(() => setUserStatus(admin.ctx, admin.id, 'SUSPENDED', 'Testing myself')),
    ).toBe('FORBIDDEN');
    // A customer holds none of this.
    expect(await code(() => exportReport(customer.ctx, 'transfers', 'csv'))).toBe('FORBIDDEN');
  });
});

describe('report exports served by /api/exports', () => {
  const range = resolveRange({ days: 30 });
  const text = (data: Uint8Array): string => new TextDecoder().decode(data);

  it('produces a valid CSV, XLSX and PDF and audits each export', async () => {
    const treasury = await createStaff('TREASURY');
    const csv = await exportReport(treasury.ctx, 'treasury', 'csv', range);
    expect(csv.contentType).toBe('text/csv; charset=utf-8');
    expect(csv.fileName).toMatch(/^bi-rem-treasury-positions-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = text(csv.data)
      .replace(/^\u{FEFF}/u, '')
      .trim()
      .split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    const columns = lines[0]?.split(',').length ?? 0;
    expect(columns).toBeGreaterThan(3);
    expect(lines.every((line) => line.split(',').length >= columns)).toBe(true);

    const xlsx = await exportReport(treasury.ctx, 'treasury', 'xlsx', range);
    expect(Array.from(xlsx.data.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]); // PK.. (zip)
    const pdf = await exportReport(treasury.ctx, 'treasury', 'pdf', range);
    expect(text(pdf.data.slice(0, 5))).toBe('%PDF-');
    expect(text(pdf.data.slice(-1024))).toContain('%%EOF');

    const audits = await db.auditLog.findMany({
      where: { action: 'report.export', actorId: treasury.id },
    });
    expect(audits.map((row) => (row.metadata as { format: string }).format).sort()).toEqual([
      'csv',
      'pdf',
      'xlsx',
    ]);
  });

  it('refuses roles without reports:export and datasets a role may not read', async () => {
    const [support, treasury, compliance] = await Promise.all([
      createStaff('SUPPORT'),
      createStaff('TREASURY'),
      createStaff('COMPLIANCE'),
    ]);
    expect(await code(() => exportReport(support.ctx, 'transfers', 'csv', range))).toBe(
      'FORBIDDEN',
    );
    expect(await code(() => exportReport(treasury.ctx, 'audit', 'csv', range))).toBe('FORBIDDEN');
    expect(await code(() => exportReport(treasury.ctx, 'compliance', 'csv', range))).toBe(
      'FORBIDDEN',
    );
    expect(await code(() => exportReport(compliance.ctx, 'audit', 'pdf', range))).toBe('ok');
    expect(await code(() => exportReport(compliance.ctx, 'nope', 'csv', range))).toBe('NOT_FOUND');
    expect(await code(() => exportReport(compliance.ctx, 'audit', 'docx', range))).toBe(
      'VALIDATION',
    );
  });
});

describe('back-office helpers', () => {
  it('flattens search params and builds filter links', () => {
    expect(
      flattenParams({
        q: '  amina ',
        tags: ['a', 'b'],
        empty: '',
        missing: undefined,
        blank: '   ',
      }),
    ).toEqual({ q: 'amina', tags: 'a' });
    expect(hrefWith('/admin/customers', { q: 'a b', page: 2, risk: undefined, kyc: '' })).toBe(
      '/admin/customers?q=a+b&page=2',
    );
    expect(hrefWith('/admin/customers', {})).toBe('/admin/customers');
  });

  it('falls back instead of failing on hostile search params', () => {
    expect(pageParam.parse('abc')).toBe(1);
    expect(pageParam.parse('-4')).toBe(1);
    expect(pageParam.parse('3')).toBe(3);
    expect(uuidParam.parse("' OR 1=1 --")).toBeUndefined();
    expect(enumParam(['LOW', 'HIGH']).parse('<script>')).toBeUndefined();
    expect(enumParam(['LOW', 'HIGH']).parse('HIGH')).toBe('HIGH');
  });

  it('formats basis points and day bounds, and reads checkboxes', () => {
    expect(percentBps(0)).toBe('0.00%');
    expect(percentBps(175)).toBe('1.75%');
    expect(percentBps(10_000)).toBe('100.00%');
    expect(dayStart('2026-11-10')?.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(dayEnd('2026-11-10')?.toISOString()).toBe('2026-11-10T23:59:59.999Z');
    expect(dayStart(undefined)).toBeUndefined();
    expect(checkbox.parse('on')).toBe(true);
    expect(checkbox.parse(undefined)).toBe(false);
    expect(checkbox.parse('off')).toBe(false);
  });
});
