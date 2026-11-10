import { afterEach, describe, expect, it } from 'vitest';

import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  totpAuthUri,
  totpCode,
  verifyTotp,
} from '@/server/auth/totp';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  hashToken,
  hmacSha256Hex,
  randomCode,
  randomToken,
  reencryptSecret,
  secretKeyVersion,
  signWebhookPayload,
  timingSafeEqualString,
  verifyPassword,
  verifyWebhookSignature,
} from '@/server/crypto';
import { EnvError, parseEnv, resetEnvCache } from '@/server/env';

const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');
const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
  resetEnvCache();
});

describe('AES-256-GCM secrets', () => {
  it('round-trips and produces a fresh ciphertext each time', () => {
    const plaintext = JSON.stringify({ token: 'fake_other_vendor_123', note: 'ünïcødé ✓' });
    const first = encryptSecret(plaintext);
    const second = encryptSecret(plaintext);
    expect(first).toMatch(/^v1\./);
    expect(first).not.toBe(second);
    expect(first).not.toContain('fake_other_vendor_123');
    expect(decryptSecret(first)).toBe(plaintext);
    expect(decryptSecret(second)).toBe(plaintext);
    expect(decryptSecret(encryptSecret(''))).toBe('');
  });

  it('detects tampering and malformed envelopes', () => {
    const envelope = encryptSecret('hello world');
    const parts = envelope.split('.');
    const flipped = [...parts];
    // Flip the FIRST base64url character: the last one may carry only padding bits, in which
    // case changing it decodes to the same bytes and the test would pass or fail at random.
    flipped[3] = `${parts[3]!.startsWith('A') ? 'B' : 'A'}${parts[3]!.slice(1)}`;
    expect(() => decryptSecret(flipped.join('.'))).toThrow(/could not be decrypted/);
    const badTag = [...parts];
    badTag[2] = Buffer.alloc(16, 9).toString('base64url');
    expect(() => decryptSecret(badTag.join('.'))).toThrow(/could not be decrypted/);
    expect(() => decryptSecret('not-an-envelope')).toThrow(/Malformed/);
  });

  it('supports key rotation: old ciphertexts decrypt, new ones use the new version', () => {
    process.env.ENCRYPTION_KEY = KEY_A;
    process.env.ENCRYPTION_KEY_VERSION = '1';
    resetEnvCache();
    const old = encryptSecret('rotate me');
    expect(secretKeyVersion(old)).toBe(1);

    process.env.ENCRYPTION_KEY = KEY_B;
    process.env.ENCRYPTION_KEY_VERSION = '2';
    process.env.ENCRYPTION_KEYS_PREVIOUS = JSON.stringify({ 1: KEY_A });
    resetEnvCache();
    expect(decryptSecret(old)).toBe('rotate me');
    const fresh = reencryptSecret(old);
    expect(secretKeyVersion(fresh)).toBe(2);
    expect(decryptSecret(fresh)).toBe('rotate me');
    expect(reencryptSecret(fresh)).toBe(fresh);

    // Without the old key the old ciphertext is unreadable — and the wrong key never "works".
    delete process.env.ENCRYPTION_KEYS_PREVIOUS;
    resetEnvCache();
    expect(() => decryptSecret(old)).toThrow(/No encryption key/);
    process.env.ENCRYPTION_KEY_VERSION = '1';
    resetEnvCache();
    expect(() => decryptSecret(old)).toThrow(/could not be decrypted/);
  });
});

describe('passwords and tokens', () => {
  it('hashes with scrypt and a random salt', async () => {
    const first = await hashPassword('Correct-Horse-9');
    const second = await hashPassword('Correct-Horse-9');
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword('Correct-Horse-9', first)).toBe(true);
    expect(await verifyPassword('correct-horse-9', first)).toBe(false);
    expect(await verifyPassword('Correct-Horse-9', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$1$2$3$4$5')).toBe(false);
  });

  it('generates tokens and references', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(randomToken());
    expect(randomCode(10)).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(timingSafeEqualString('abc', 'abc')).toBe(true);
    expect(timingSafeEqualString('abc', 'abd')).toBe(false);
    expect(timingSafeEqualString('abc', 'abcd')).toBe(false);
  });
});

describe('webhook signatures', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  const body = '{"eventId":"1"}';

  it('signs and verifies, with the current or the previous secret', () => {
    const header = signWebhookPayload('secret-one', body, now);
    expect(header).toBe(`t=1794304800,v1=${hmacSha256Hex('secret-one', `1794304800.${body}`)}`);
    expect(verifyWebhookSignature('secret-one', body, header, { now })).toEqual({
      ok: true,
      timestamp: 1_794_304_800,
    });
    expect(verifyWebhookSignature(['secret-two', 'secret-one'], body, header, { now }).ok).toBe(
      true,
    );
  });

  it('rejects wrong secrets, altered bodies, stale timestamps and junk', () => {
    const header = signWebhookPayload('secret-one', body, now);
    expect(verifyWebhookSignature('other', body, header, { now })).toEqual({
      ok: false,
      reason: 'MISMATCH',
    });
    expect(verifyWebhookSignature('secret-one', `${body} `, header, { now })).toEqual({
      ok: false,
      reason: 'MISMATCH',
    });
    const late = new Date(now.getTime() + 301_000);
    expect(verifyWebhookSignature('secret-one', body, header, { now: late })).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
    const early = new Date(now.getTime() - 301_000);
    expect(verifyWebhookSignature('secret-one', body, header, { now: early })).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
    for (const junk of [
      null,
      undefined,
      '',
      'v1=abc',
      't=abc,v1=def',
      't=1794304800',
      `t=1794304800,v1=${'z'.repeat(64)}`,
    ]) {
      expect(verifyWebhookSignature('secret-one', body, junk, { now })).toEqual({
        ok: false,
        reason: 'MALFORMED',
      });
    }
  });
});

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  // RFC 4226 appendix D test secret "12345678901234567890".
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC 4226 HOTP vectors', () => {
    const key = Buffer.from('12345678901234567890');
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expected.forEach((code, counter) => expect(hotp(key, counter)).toBe(code));
  });

  it('matches the RFC 6238 SHA-1 vectors (8 digits)', () => {
    expect(totpCode(secret, new Date(59_000), 8)).toBe('94287082');
    expect(totpCode(secret, new Date(1_111_111_109_000), 8)).toBe('07081804');
    expect(totpCode(secret, new Date(1_234_567_890_000), 8)).toBe('89005924');
    expect(totpCode(secret, new Date(20_000_000_000_000), 8)).toBe('65353130');
  });

  it('verifies within one step of drift only', () => {
    const at = new Date('2026-11-10T10:00:15Z');
    const code = totpCode(secret, at);
    expect(verifyTotp(secret, code, { at })).toBe(true);
    expect(verifyTotp(secret, ` ${code.slice(0, 3)} ${code.slice(3)} `, { at })).toBe(true);
    expect(verifyTotp(secret, code, { at: new Date(at.getTime() + 30_000) })).toBe(true);
    expect(verifyTotp(secret, code, { at: new Date(at.getTime() - 30_000) })).toBe(true);
    expect(verifyTotp(secret, code, { at: new Date(at.getTime() + 90_000) })).toBe(false);
    expect(verifyTotp(secret, '12345', { at })).toBe(false);
    expect(verifyTotp(secret, 'abcdef', { at })).toBe(false);
  });

  it('encodes base32 and builds an otpauth URI', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb oi==').toString()).toBe('foobar');
    expect(() => base32Decode('MZXW1')).toThrow();
    const generated = generateTotpSecret();
    expect(generated).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(generated)).toHaveLength(20);
    const uri = totpAuthUri(generated, 'amina@example.com', 'BI-Rem Lite');
    expect(uri).toContain('otpauth://totp/BI-Rem%20Lite%3Aamina%40example.com?');
    expect(uri).toContain(`secret=${generated}`);
    expect(uri).toContain('issuer=BI-Rem+Lite');
  });
});

describe('environment validation', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

  it('falls back to development values outside production', () => {
    const env = parseEnv({ ...base, NODE_ENV: 'test' });
    expect(env.isProduction).toBe(false);
    expect(env.authSecret.length).toBeGreaterThanOrEqual(32);
    expect(env.encryptionKey).toHaveLength(32);
    expect(env.seedDemoData).toBe(true);
    expect(env.seedAdminEmail).toBe('admin@bi-rem.local');
    expect(env.databaseUrlUnpooled).toBe(base.DATABASE_URL);
    expect(env.appName).toBe('BI-Rem Lite');
  });

  it('requires real secrets in production and defaults demo data off', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /AUTH_SECRET and ENCRYPTION_KEY must be set/,
    );
    expect(() =>
      parseEnv({ ...base, VERCEL_ENV: 'production', AUTH_SECRET: 'x'.repeat(32) }),
    ).toThrow(/ENCRYPTION_KEY must be set/);
    const env = parseEnv({
      ...base,
      NODE_ENV: 'production',
      AUTH_SECRET: 'x'.repeat(40),
      ENCRYPTION_KEY: KEY_A,
      DATABASE_URL_UNPOOLED: 'postgresql://u:p@direct:5432/db',
      SEED_DEMO_DATA: '',
    });
    expect(env.isProduction).toBe(true);
    expect(env.seedDemoData).toBe(false);
    expect(env.seedAdminPasswordProvided).toBe(false);
    expect(env.databaseUrlUnpooled).toBe('postgresql://u:p@direct:5432/db');
    expect(
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        AUTH_SECRET: 'x'.repeat(40),
        ENCRYPTION_KEY: KEY_A,
        SEED_DEMO_DATA: 'true',
      }).seedDemoData,
    ).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(() => parseEnv({ NODE_ENV: 'test' })).toThrow(EnvError);
    expect(() => parseEnv({ ...base, AUTH_SECRET: 'too-short' })).toThrow(/at least 32/);
    expect(() =>
      parseEnv({ ...base, ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/32 bytes/);
    expect(() => parseEnv({ ...base, ENCRYPTION_KEYS_PREVIOUS: 'not json' })).toThrow(
      /ENCRYPTION_KEYS_PREVIOUS/,
    );
    expect(() => parseEnv({ ...base, SEED_ADMIN_EMAIL: 'nope' })).toThrow(EnvError);
    expect(() => parseEnv({ ...base, SEED_DEMO_DATA: 'maybe' })).toThrow(EnvError);
  });
});
