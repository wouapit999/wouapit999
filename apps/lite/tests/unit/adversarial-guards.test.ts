import { afterEach, describe, expect, it } from 'vitest';

import { safeNextPath } from '@/server/auth/redirect';
import { matchTotpCounter, totpCode, verifyTotp } from '@/server/auth/totp';
import { parseEnv, resetEnvCache } from '@/server/env';
import { MAX_AMOUNT_MINOR, assertAmountInRange } from '@/server/money';
import { isPrivateAddress, parseOutboundUrl } from '@/server/net-guard';

/**
 * Regression tests for the guards hardened by the adversarial security review: the SSRF filter,
 * the post-login redirect, production secrets and the amount ceiling.
 */

describe('SSRF guard', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
  });

  it('judges IPv6 addresses that wrap an IPv4 address by the IPv4 address', () => {
    for (const address of [
      // What `new URL('https://[::ffff:127.0.0.1]/')` turns the host into.
      '::ffff:7f00:1',
      '::ffff:a00:5',
      '::ffff:a9fe:a9fe',
      '::ffff:127.0.0.1',
      '0:0:0:0:0:ffff:c0a8:101',
      // IPv4-compatible, NAT64, 6to4, Teredo.
      '::7f00:1',
      '::127.0.0.1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::',
      '2001:0:4136:e378:8000:63bf:3fff:fdd2',
      // Local scopes in every spelling.
      '::',
      '::1',
      '0:0:0:0:0:0:0:1',
      'fc00::1',
      'fdab::1',
      'fe80::1%eth0',
      'febf::1',
      'fec0::1',
      'ff02::1',
      '2001:db8::1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of [
      '2606:4700:4700::1111',
      '2a00:1450:4007:80e::200e',
      '::ffff:8.8.8.8',
      '::ffff:808:808',
      '8.8.8.8',
    ]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('refuses every loopback / private spelling of a webhook URL in production', () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@db.example.com:5432/app',
      AUTH_SECRET: 'prod-secret-0123456789-abcdefghijklmnop',
      ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    });
    resetEnvCache();
    for (const url of [
      'https://127.0.0.1/hook',
      'https://[::1]/hook',
      'https://[::ffff:127.0.0.1]/hook',
      'https://[::ffff:10.0.0.5]/hook',
      'https://[::ffff:169.254.169.254]/latest/meta-data',
      'https://[::127.0.0.1]/hook',
      'https://[64:ff9b::7f00:1]/hook',
      'https://[2002:7f00:1::]/hook',
      'https://[fec0::1]/hook',
      'https://0x7f.1/hook',
      'https://2130706433/hook',
      'https://localhost/hook',
      'https://localhost./hook',
      'https://LOCALHOST/hook',
      'https://db.internal/hook',
      'https://printer.local/hook',
      'http://example.com/hook',
    ]) {
      expect(() => parseOutboundUrl(url), url).toThrow();
    }
    expect(parseOutboundUrl('https://hooks.example.com/bi-rem').hostname).toBe('hooks.example.com');
    expect(parseOutboundUrl('https://[2606:4700:4700::1111]/x').hostname).toBe(
      '[2606:4700:4700::1111]',
    );
  });
});

describe('post-login redirect', () => {
  it('only honours same-origin paths inside the area of the role', () => {
    expect(safeNextPath('/app/transfers?page=2', 'CUSTOMER')).toBe('/app/transfers?page=2');
    expect(safeNextPath('/admin/kyc', 'COMPLIANCE')).toBe('/admin/kyc');
    expect(safeNextPath(undefined, 'PARTNER')).toBe('/partner');
    for (const next of [
      '//evil.example',
      'https://evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/admin',
      '/partner/api-keys',
      '/app/../admin',
      '/app/..',
      '/app/./../admin/users',
      '/app/%2e%2e/admin',
      '/app/%2E%2E%2Fadmin',
      '/app%2f..%2fadmin',
      '/app/x%5c..%5cadmin',
      '/app\t//evil.example',
      '/app\n/evil',
      '/roadmap',
      '',
    ]) {
      expect(safeNextPath(next, 'CUSTOMER'), JSON.stringify(next)).toBe('/app');
    }
  });
});

describe('production secrets', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@db.example.com:5432/app' };
  const devAuthSecret = parseEnv({ ...base, NODE_ENV: 'test' }).authSecret;
  const devKey = parseEnv({ ...base, NODE_ENV: 'test' }).encryptionKey.toString('base64');
  const realKey = Buffer.alloc(32, 5).toString('base64');

  it('refuses the public development values when they are set explicitly in production', () => {
    for (const production of [{ NODE_ENV: 'production' }, { VERCEL_ENV: 'production' }]) {
      expect(() =>
        parseEnv({ ...base, ...production, AUTH_SECRET: devAuthSecret, ENCRYPTION_KEY: realKey }),
      ).toThrow(/AUTH_SECRET is the public development value/);
      expect(() =>
        parseEnv({
          ...base,
          ...production,
          AUTH_SECRET: 'prod-secret-0123456789-abcdefghijklmnop',
          ENCRYPTION_KEY: devKey,
        }),
      ).toThrow(/ENCRYPTION_KEY is the public development value/);
    }
    // The same values remain fine for local development.
    expect(
      parseEnv({
        ...base,
        NODE_ENV: 'development',
        AUTH_SECRET: devAuthSecret,
        ENCRYPTION_KEY: devKey,
      }).isProduction,
    ).toBe(false);
  });
});

describe('amounts and one-time codes', () => {
  it('bounds a single movement so the ledger can never overflow bigint', () => {
    expect(() => assertAmountInRange(1n)).not.toThrow();
    expect(() => assertAmountInRange(MAX_AMOUNT_MINOR)).not.toThrow();
    for (const amount of [0n, -1n, MAX_AMOUNT_MINOR + 1n, 9_223_372_036_854_775_807n]) {
      expect(() => assertAmountInRange(amount), String(amount)).toThrow();
    }
    // Nine thousand maximal movements still fit a Postgres int8 balance.
    expect(MAX_AMOUNT_MINOR * 9_000n).toBeLessThan(9_223_372_036_854_775_807n);
  });

  it('reports which time step a TOTP code belongs to, so it can be burned after use', () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const at = new Date('2026-11-10T12:00:10Z');
    const step = Math.floor(at.getTime() / 30_000);
    expect(matchTotpCounter(secret, totpCode(secret, at), { at })).toBe(step);
    expect(
      matchTotpCounter(secret, totpCode(secret, new Date(at.getTime() - 30_000)), { at }),
    ).toBe(step - 1);
    expect(
      matchTotpCounter(secret, totpCode(secret, new Date(at.getTime() + 90_000)), { at }),
    ).toBe(null);
    expect(matchTotpCounter(secret, '12345', { at })).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, at), { at })).toBe(true);
  });
});
