import { describe, expect, it } from '@jest/globals';

import {
  decodeEncryptionKey,
  isDegenerateKey,
  isLowEntropySecret,
  parseDurationSeconds,
  validateEnv,
} from './env.js';

const RANDOM_KEY = 'q7Zk2mVt9xP4bR8wL1nY5cJ3hF6gD0sA2eU4iO7pT9k=';

function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://birem:birem@localhost:5432/birem',
    JWT_ACCESS_SECRET: 'access-secret-with-plenty-of-variety-0123456789',
    JWT_REFRESH_SECRET: 'refresh-secret-with-plenty-of-variety-9876543210',
    ENCRYPTION_KEY: RANDOM_KEY,
    ...overrides,
  };
}

describe('validateEnv', () => {
  it('resolves derived values for a valid configuration', () => {
    const config = validateEnv(baseEnv({ JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL: '30d' }));
    expect(config.jwtAccessTtlSeconds).toBe(900);
    expect(config.jwtRefreshTtlSeconds).toBe(30 * 86_400);
    expect(config.databaseRuntimeUrl).toBe(config.DATABASE_URL);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
    expect(config.isProduction).toBe(false);
  });

  it('lists every schema problem at once', () => {
    let message = '';
    try {
      validateEnv(baseEnv({ JWT_ACCESS_SECRET: 'short', ENCRYPTION_KEY: 'nope', API_PORT: '0' }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('Invalid environment configuration');
    for (const name of ['JWT_ACCESS_SECRET', 'ENCRYPTION_KEY', 'API_PORT']) {
      expect(message).toContain(`- ${name}:`);
    }
  });

  it('refuses identical access and refresh secrets in every environment', () => {
    const shared = 'one-secret-used-for-both-token-kinds-0123456789';
    expect(() =>
      validateEnv(baseEnv({ JWT_ACCESS_SECRET: shared, JWT_REFRESH_SECRET: shared })),
    ).toThrow(/must be different/);
  });

  it('refuses the shipped placeholder secrets in production', () => {
    expect(() =>
      validateEnv(
        baseEnv({
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: 'change-me-access-secret-min-32-chars-long',
        }),
      ),
    ).toThrow(/JWT_ACCESS_SECRET still has its placeholder value/);
    expect(() =>
      validateEnv(
        baseEnv({
          NODE_ENV: 'production',
          ENCRYPTION_KEY: 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo=',
        }),
      ),
    ).toThrow(/ENCRYPTION_KEY still has its placeholder value/);
  });

  it('refuses low-entropy secrets and single-byte keys in production, accepts them in dev', () => {
    const degenerate = Buffer.alloc(32, 1).toString('base64');
    expect(() =>
      validateEnv(baseEnv({ NODE_ENV: 'production', ENCRYPTION_KEY: degenerate })),
    ).toThrow(/ENCRYPTION_KEY is not random enough/);
    expect(() =>
      validateEnv(baseEnv({ NODE_ENV: 'production', JWT_REFRESH_SECRET: 'ab'.repeat(20) })),
    ).toThrow(/JWT_REFRESH_SECRET is not random enough/);
    expect(() => validateEnv(baseEnv({ ENCRYPTION_KEY: degenerate }))).not.toThrow();
    expect(() => validateEnv(baseEnv({ NODE_ENV: 'production' }))).not.toThrow();
  });
});

describe('secret helpers', () => {
  it('decodes 32-byte keys from base64 or hex and rejects anything else', () => {
    expect(decodeEncryptionKey(RANDOM_KEY)).toHaveLength(32);
    expect(decodeEncryptionKey('ab'.repeat(32))).toEqual(Buffer.alloc(32, 0xab));
    expect(() => decodeEncryptionKey(Buffer.alloc(16, 1).toString('base64'))).toThrow();
    expect(() => decodeEncryptionKey('not base64 at all!!')).toThrow();
  });

  it('flags degenerate keys and repetitive secrets', () => {
    expect(isDegenerateKey(Buffer.alloc(32, 7))).toBe(true);
    expect(isDegenerateKey(decodeEncryptionKey(RANDOM_KEY))).toBe(false);
    expect(isLowEntropySecret('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(isLowEntropySecret('1234123412341234123412341234123412')).toBe(true);
    expect(isLowEntropySecret('refresh-secret-with-plenty-of-variety-9876543210')).toBe(false);
  });

  it('parses durations and rejects malformed ones', () => {
    expect(parseDurationSeconds('45s')).toBe(45);
    expect(parseDurationSeconds('2h')).toBe(7_200);
    expect(() => parseDurationSeconds('15 minutes')).toThrow(/Invalid duration/);
  });
});
