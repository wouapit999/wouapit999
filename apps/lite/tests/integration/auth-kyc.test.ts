import { describe, expect, it } from 'vitest';

import {
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  beginMfaEnrolment,
  changePassword,
  confirmMfaEnrolment,
  disableMfa,
  login,
  logout,
  registerCustomer,
  resolveSession,
  totpCode,
  updateProfile,
  verifySessionToken,
} from '@/server/auth';
import { db } from '@/server/db';
import {
  getKycCase,
  getKycDocument,
  getLimitOverview,
  listKycCases,
  reviewKycCase,
  submitKycCase,
} from '@/server/kyc';
import { hitRateLimit } from '@/server/rate-limit';
import type { ActionContext } from '@/server/rbac';
import { searchUsers, setUserStatus } from '@/server/users';

import { withTestDatabase } from '../helpers/db';
import { createCustomer, createStaff } from '../helpers/factories';

withTestDatabase();

const PASSWORD = 'Correct-Horse-9';
let counter = 0;
const newEmail = (): string => `person-${Date.now()}-${(counter += 1)}@test.local`;
const ctxOf = (user: { id: string; email: string }): ActionContext => ({
  actor: { type: 'USER', id: user.id, role: 'CUSTOMER', label: user.email, partnerId: null },
});

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
]);
const PDF = new TextEncoder().encode('%PDF-1.4 demo proof of address');

describe('registration and login', () => {
  it('registers a customer with a hashed password and a home-currency wallet', async () => {
    const email = newEmail();
    const user = await registerCustomer({
      email: email.toUpperCase(),
      password: PASSWORD,
      fullName: 'Awa Test',
      countryCode: 'ao',
    });
    expect(user).toMatchObject({ email, role: 'CUSTOMER', kycTier: 'TIER_0', countryCode: 'AO' });
    const row = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { wallets: true },
    });
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain(PASSWORD);
    expect(row.wallets.map((wallet) => wallet.currency)).toEqual(['AOA']);
    expect(
      await db.auditLog.count({ where: { action: 'auth.register', resourceId: user.id } }),
    ).toBe(1);

    await expect(
      registerCustomer({ email, password: PASSWORD, fullName: 'Awa Again', countryCode: 'AO' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      registerCustomer({
        email: newEmail(),
        password: PASSWORD,
        fullName: 'Planned',
        countryCode: 'NG',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      registerCustomer({
        email: newEmail(),
        password: 'short1',
        fullName: 'Weak',
        countryCode: 'CM',
      }),
    ).rejects.toThrow();
  });

  it('logs in, resolves the session, and logout revokes it', async () => {
    const email = newEmail();
    const user = await registerCustomer({
      email,
      password: PASSWORD,
      fullName: 'Login Test',
      countryCode: 'CM',
    });
    const result = await login(
      { email, password: PASSWORD },
      { ip: '203.0.113.7', userAgent: 'vitest' },
    );
    if (result.status !== 'OK') throw new Error('expected OK');
    expect(result.user.id).toBe(user.id);
    expect((await verifySessionToken(result.token))?.sub).toBe(user.id);
    expect((await resolveSession(result.token))?.user.email).toBe(email);
    expect(await resolveSession(`${result.token}x`)).toBeNull();
    expect(await resolveSession('garbage')).toBeNull();

    await logout(result.sessionId, ctxOf(user));
    expect(await resolveSession(result.token)).toBeNull();
    expect(
      await db.auditLog.count({ where: { action: 'auth.logout', resourceId: result.sessionId } }),
    ).toBe(1);
  });

  it('locks the account after five failed attempts, even for the right password', async () => {
    const email = newEmail();
    const user = await registerCustomer({
      email,
      password: PASSWORD,
      fullName: 'Lockout Test',
      countryCode: 'CM',
    });
    for (let attempt = 1; attempt < MAX_FAILED_LOGINS; attempt += 1) {
      await expect(login({ email, password: 'wrong-password-1' })).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Incorrect e-mail or password',
      });
    }
    await expect(login({ email, password: 'wrong-password-1' })).rejects.toThrow(
      /locked for 15 minutes/,
    );
    const locked = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(
      Date.now() + (LOCKOUT_MINUTES - 1) * 60_000,
    );
    await expect(login({ email, password: PASSWORD })).rejects.toThrow(/temporarily locked/);
    expect(await db.loginAttempt.count({ where: { email, success: false } })).toBe(
      MAX_FAILED_LOGINS + 1,
    );

    // Once the lock expires the right password works again and the counter resets.
    await db.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    await db.rateLimitBucket.deleteMany({ where: { key: `login:email:${email}` } });
    const ok = await login({ email, password: PASSWORD });
    expect(ok.status).toBe('OK');
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(0);
  });

  it('gives the same answer for unknown e-mails and wrong passwords', async () => {
    const email = newEmail();
    await registerCustomer({ email, password: PASSWORD, fullName: 'Enum Test', countryCode: 'CM' });
    const unknown = await login({ email: newEmail(), password: PASSWORD }).catch(
      (error: Error) => error.message,
    );
    const wrong = await login({ email, password: 'wrong-password-1' }).catch(
      (error: Error) => error.message,
    );
    expect(unknown).toBe('Incorrect e-mail or password');
    expect(wrong).toBe(unknown);
  });

  it('rate limits by key in the database', async () => {
    const rule = { limit: 3, windowSeconds: 60 };
    const key = `test:${Date.now()}`;
    const now = new Date('2026-11-10T10:00:10Z');
    const results = [];
    for (let index = 0; index < 5; index += 1) results.push(await hitRateLimit(key, rule, now));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false, false]);
    expect(results[3]?.retryAfterSeconds).toBe(50);
    // Next window starts fresh.
    expect((await hitRateLimit(key, rule, new Date('2026-11-10T10:01:00Z'))).allowed).toBe(true);
  });

  it('suspended users cannot log in and lose their sessions', async () => {
    const admin = await createStaff('ADMIN');
    const email = newEmail();
    const user = await registerCustomer({
      email,
      password: PASSWORD,
      fullName: 'Suspend Test',
      countryCode: 'CM',
    });
    const session = await login({ email, password: PASSWORD });
    if (session.status !== 'OK') throw new Error('expected OK');
    await expect(
      setUserStatus(ctxOf(user), user.id, 'SUSPENDED', 'self-service'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await setUserStatus(admin.ctx, user.id, 'SUSPENDED', 'Chargeback investigation');
    expect(await resolveSession(session.token)).toBeNull();
    await expect(login({ email, password: PASSWORD })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const found = await searchUsers(admin.ctx, { search: 'suspend test', status: 'SUSPENDED' });
    expect(found.items.map((item) => item.id)).toContain(user.id);
    expect(JSON.stringify(found)).not.toContain('scrypt$');
  });
});

describe('TOTP multi-factor authentication', () => {
  it('enrols, requires a code at login, rejects wrong codes and can be disabled', async () => {
    const email = newEmail();
    const user = await registerCustomer({
      email,
      password: PASSWORD,
      fullName: 'Mfa Test',
      countryCode: 'CM',
    });
    const ctx = ctxOf(user);
    const enrolment = await beginMfaEnrolment(ctx);
    expect(enrolment.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrolment.otpauthUri).toContain('otpauth://totp/');

    // Stored encrypted, not in clear.
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.mfaSecretEnc).toMatch(/^v1\./);
    expect(row.mfaSecretEnc).not.toContain(enrolment.secret);
    expect(row.mfaEnabled).toBe(false);

    await expect(confirmMfaEnrolment(ctx, '000000')).rejects.toMatchObject({ code: 'VALIDATION' });
    await confirmMfaEnrolment(ctx, totpCode(enrolment.secret));

    expect(await login({ email, password: PASSWORD })).toEqual({ status: 'MFA_REQUIRED' });
    await expect(login({ email, password: PASSWORD, totpCode: '123456' })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    const ok = await login({ email, password: PASSWORD, totpCode: totpCode(enrolment.secret) });
    expect(ok.status).toBe('OK');

    await expect(
      disableMfa(ctx, { password: 'wrong-password-1', code: totpCode(enrolment.secret) }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await disableMfa(ctx, { password: PASSWORD, code: totpCode(enrolment.secret) });
    expect((await login({ email, password: PASSWORD })).status).toBe('OK');
  });

  it('changing the password signs out other sessions', async () => {
    const email = newEmail();
    const user = await registerCustomer({
      email,
      password: PASSWORD,
      fullName: 'Password Test',
      countryCode: 'CM',
    });
    const first = await login({ email, password: PASSWORD });
    const second = await login({ email, password: PASSWORD });
    if (first.status !== 'OK' || second.status !== 'OK') throw new Error('expected OK');
    await expect(
      changePassword(ctxOf(user), {
        currentPassword: 'nope-nope-1',
        newPassword: 'Another-Pass-77',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await changePassword(
      ctxOf(user),
      { currentPassword: PASSWORD, newPassword: 'Another-Pass-77' },
      second.sessionId,
    );
    expect(await resolveSession(first.token)).toBeNull();
    expect(await resolveSession(second.token)).not.toBeNull();
    await expect(login({ email, password: PASSWORD })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect((await login({ email, password: 'Another-Pass-77' })).status).toBe('OK');
  });

  it('profile updates are audited with before/after', async () => {
    const user = await registerCustomer({
      email: newEmail(),
      password: PASSWORD,
      fullName: 'Old Name',
      countryCode: 'CM',
    });
    await updateProfile(ctxOf(user), {
      fullName: 'New Name',
      city: 'Douala',
      dateOfBirth: '1990-05-17',
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'user.profile.update', resourceId: user.id },
    });
    expect(audit.before).toMatchObject({ fullName: 'Old Name' });
    expect(audit.after).toMatchObject({ fullName: 'New Name', city: 'Douala' });
  });
});

describe('KYC', () => {
  const submission = {
    targetTier: 'TIER_1' as const,
    idType: 'NATIONAL_ID' as const,
    idCountry: 'CM',
  };
  const front = { kind: 'ID_FRONT' as const, fileName: 'id.png', mimeType: 'image/png', data: PNG };

  it('auto-approves a clean document and raises the tier and limits', async () => {
    const customer = await createCustomer({ tier: 'TIER_0' });
    const before = await getLimitOverview(customer.ctx);
    const kycCase = await submitKycCase(customer.ctx, { ...submission, idNumber: 'CM-1234-5678' }, [
      front,
    ]);
    expect(kycCase).toMatchObject({
      status: 'APPROVED',
      vendor: 'smile_identity',
      vendorDecision: 'APPROVE',
    });
    expect(kycCase.vendorResult).toMatchObject({ simulated: true });
    const user = await db.user.findUniqueOrThrow({ where: { id: customer.id } });
    expect(user).toMatchObject({ kycTier: 'TIER_1', kycStatus: 'VERIFIED' });
    const after = await getLimitOverview(customer.ctx);
    expect(after.limits.perTransaction).toBeGreaterThan(before.limits.perTransaction);
    expect(after.limits.international).toBe(true);

    // Stored as bytea with its sha256; only the owner and reviewers can read it.
    const document = await db.kycDocument.findFirstOrThrow({ where: { caseId: kycCase.id } });
    expect(Buffer.from(document.data).equals(Buffer.from(PNG))).toBe(true);
    expect(document.sha256).toMatch(/^[0-9a-f]{64}$/);
    const stranger = await createCustomer();
    await expect(getKycDocument(stranger.ctx, document.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(getKycCase(stranger.ctx, kycCase.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await getKycDocument(customer.ctx, document.id)).size).toBe(PNG.byteLength);
    const support = await createStaff('SUPPORT');
    await expect(getKycDocument(support.ctx, document.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const compliance = await createStaff('COMPLIANCE');
    await getKycDocument(compliance.ctx, document.id);
    expect(
      await db.auditLog.count({ where: { action: 'kyc.document.view', resourceId: document.id } }),
    ).toBe(1);
  });

  it('queues uncertain cases for review; compliance approves or rejects', async () => {
    const compliance = await createStaff('COMPLIANCE');
    const support = await createStaff('SUPPORT');
    const customer = await createCustomer({ tier: 'TIER_0', country: 'MZ' });
    const kycCase = await submitKycCase(
      customer.ctx,
      { ...submission, idCountry: 'MZ', idNumber: 'MZ-REVIEW-01' },
      [front],
    );
    expect(kycCase).toMatchObject({
      status: 'IN_REVIEW',
      vendor: 'sumsub',
      vendorDecision: 'REVIEW',
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: customer.id } })).kycStatus).toBe(
      'PENDING',
    );

    // One open case at a time.
    await expect(
      submitKycCase(customer.ctx, { ...submission, idNumber: 'MZ-2' }, [front]),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const queue = await listKycCases(compliance.ctx, { status: 'IN_REVIEW' });
    expect(queue.items.map((item) => item.id)).toContain(kycCase.id);
    await expect(listKycCases(customer.ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      reviewKycCase(support.ctx, kycCase.id, { decision: 'APPROVE', note: 'looks fine' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const approved = await reviewKycCase(compliance.ctx, kycCase.id, {
      decision: 'APPROVE',
      note: 'Matched against the selfie.',
    });
    expect(approved.status).toBe('APPROVED');
    expect((await db.user.findUniqueOrThrow({ where: { id: customer.id } })).kycTier).toBe(
      'TIER_1',
    );
    await expect(
      reviewKycCase(compliance.ctx, kycCase.id, { decision: 'REJECT', note: 'second opinion' }),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(
      await db.notification.count({ where: { userId: customer.id, type: 'kyc.approved' } }),
    ).toBe(1);
  });

  it('rejects forged documents and lets the customer resubmit', async () => {
    const customer = await createCustomer({ tier: 'TIER_0' });
    const rejected = await submitKycCase(
      customer.ctx,
      { ...submission, idType: 'PASSPORT', idNumber: 'P0000' },
      [front],
    );
    expect(rejected).toMatchObject({ status: 'REJECTED', vendor: 'veriff' });
    expect((await db.user.findUniqueOrThrow({ where: { id: customer.id } })).kycStatus).toBe(
      'REJECTED',
    );
    const retry = await submitKycCase(customer.ctx, { ...submission, idNumber: 'CM-7777' }, [
      front,
    ]);
    expect(retry.status).toBe('APPROVED');
  });

  it('validates uploads: size, type, content sniffing and required documents', async () => {
    const customer = await createCustomer({ tier: 'TIER_0' });
    const submit = (
      documents: Parameters<typeof submitKycCase>[2],
      tier: 'TIER_1' | 'TIER_2' = 'TIER_1',
    ) =>
      submitKycCase(
        customer.ctx,
        { ...submission, targetTier: tier, idNumber: 'CM-5555' },
        documents,
      );

    await expect(submit([])).rejects.toMatchObject({ code: 'VALIDATION' });
    const tooBig = new Uint8Array(1024 * 1024 + 1);
    tooBig.set(PNG);
    await expect(submit([{ ...front, data: tooBig }])).rejects.toThrow(/larger than 1 MB/);
    await expect(
      submit([{ ...front, data: new TextEncoder().encode('<html><script>alert(1)</script>') }]),
    ).rejects.toThrow(/JPEG, PNG, WebP or PDF/);
    await expect(submit([{ ...front, mimeType: 'application/pdf' }])).rejects.toThrow(
      /does not match/,
    );
    await expect(submit([{ ...front, kind: 'SELFIE' }])).rejects.toThrow(/front of your ID/);
    await expect(submit([front], 'TIER_2')).rejects.toThrow(/proof of address/);
    expect(await db.kycCase.count({ where: { userId: customer.id } })).toBe(0);

    const tier2 = await submit(
      [
        front,
        { kind: 'PROOF_OF_ADDRESS', fileName: 'bill.pdf', mimeType: 'application/pdf', data: PDF },
      ],
      'TIER_2',
    );
    expect(tier2.status).toBe('APPROVED');
    expect((await db.user.findUniqueOrThrow({ where: { id: customer.id } })).kycTier).toBe(
      'TIER_2',
    );
    await expect(submit([front])).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
