import { describe, expect, it } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/env.js';
import { CryptoService } from './crypto.service.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

function makeService(key = KEY): CryptoService {
  const config = { get: () => key } as unknown as ConfigService<AppConfig, true>;
  return new CryptoService(config);
}

describe('CryptoService', () => {
  it('round-trips plaintext through AES-256-GCM', () => {
    const service = makeService();
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = service.encrypt(secret);
    expect(encrypted).not.toContain(secret);
    expect(encrypted.startsWith('v1.')).toBe(true);
    expect(service.decrypt(encrypted)).toBe(secret);
  });

  it('produces a different ciphertext for the same plaintext (random IV)', () => {
    const service = makeService();
    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  it('binds ciphertext to associated data', () => {
    const service = makeService();
    const encrypted = service.encrypt('totp-seed', 'user-1');
    expect(service.decrypt(encrypted, 'user-1')).toBe('totp-seed');
    expect(() => service.decrypt(encrypted, 'user-2')).toThrow();
  });

  it('rejects tampered ciphertext and foreign keys', () => {
    const service = makeService();
    const encrypted = service.encrypt('hello');
    const parts = encrypted.split('.');
    parts[2] = parts[2]!.slice(0, -2) + (parts[2]!.endsWith('AA') ? 'BB' : 'AA');
    expect(() => service.decrypt(parts.join('.'))).toThrow();
    expect(() => makeService(Buffer.alloc(32, 9).toString('base64')).decrypt(encrypted)).toThrow();
    expect(() => service.decrypt('not-a-ciphertext')).toThrow('Malformed ciphertext');
  });

  it('hashes deterministically and compares in constant time', () => {
    const service = makeService();
    expect(service.sha256('abc')).toBe(service.sha256('abc'));
    expect(service.sha256('abc')).toHaveLength(64);
    expect(service.safeEqual('a', 'a')).toBe(true);
    expect(service.safeEqual('a', 'ab')).toBe(false);
    expect(service.randomToken().length).toBeGreaterThanOrEqual(43);
  });
});
