import { z } from 'zod';

const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;
const DURATION_UNITS: Record<string, number> = { s: 1, m: 60, h: 3_600, d: 86_400 };

/** Parses `15m`, `30d`, `3600s` into seconds. Throws on malformed input. */
export function parseDurationSeconds(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}" (expected <number><s|m|h|d>)`);
  }
  const amount = Number(match[1]);
  const unit = DURATION_UNITS[match[2] ?? 's'] ?? 1;
  return amount * unit;
}

const durationSchema = z
  .string()
  .regex(DURATION_PATTERN, { error: 'Expected a duration such as 15m, 1h or 30d' });

/** 32-byte key given as base64 (44 chars) or hex (64 chars). Returns the raw bytes. */
export function decodeEncryptionKey(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  const decoded = Buffer.from(trimmed, 'base64');
  if (
    decoded.length !== 32 ||
    decoded.toString('base64').replace(/=+$/, '') !== trimmed.replace(/=+$/, '')
  ) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 bytes encoded as base64 or hex');
  }
  return decoded;
}

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_URL: optionalString,
  REDIS_URL: optionalString,

  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  API_BASE_URL: z.url().default('http://localhost:4000'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3001')
    .transform((raw) =>
      raw
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  CUSTOMER_PORTAL_URL: z.url().default('http://localhost:3000'),
  ADMIN_PORTAL_URL: z.url().default('http://localhost:3001'),
  APP_NAME: z.string().min(1).default('BI-Rem'),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, { error: 'JWT_ACCESS_SECRET must be at least 32 characters' }),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, { error: 'JWT_REFRESH_SECRET must be at least 32 characters' }),
  JWT_ACCESS_TTL: durationSchema.default('15m'),
  JWT_REFRESH_TTL: durationSchema.default('30d'),

  ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine(
      (value) => {
        try {
          decodeEncryptionKey(value);
          return true;
        } catch {
          return false;
        }
      },
      { error: 'ENCRYPTION_KEY must be 32 bytes encoded as base64 or hex' },
    ),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_FROM: z.string().default('BI-Rem <no-reply@bi-rem.local>'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SENTRY_DSN: optionalUrl,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
});

export type RawEnv = z.infer<typeof envSchema>;

/** Fully resolved configuration consumed through `ConfigService<AppConfig, true>`. */
export interface AppConfig extends RawEnv {
  /** Connection string the API should use at runtime (pooled when available). */
  readonly databaseRuntimeUrl: string;
  readonly jwtAccessTtlSeconds: number;
  readonly jwtRefreshTtlSeconds: number;
  readonly isProduction: boolean;
  readonly isTest: boolean;
}

/** Example values shipped in `.env.example` files and CI; they must never reach production. */
const KNOWN_EXAMPLE_SECRETS: ReadonlySet<string> = new Set([
  'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo=',
  'change-me-32-byte-base64-key====================',
]);

/** Distinct characters a random 32+ character secret is expected to exceed by a wide margin. */
const MIN_DISTINCT_SECRET_CHARS = 8;

/** True for secrets that are clearly not random (`aaaa…`, `12341234…`, a single repeated byte). */
export function isLowEntropySecret(value: string): boolean {
  return new Set(value).size < MIN_DISTINCT_SECRET_CHARS;
}

/** True when every byte of the key is identical (e.g. `Buffer.alloc(32, 1)` test keys). */
export function isDegenerateKey(key: Buffer): boolean {
  return key.every((byte) => byte === key[0]);
}

/** `@nestjs/config` `validate()` hook: fails fast with every problem listed. */
export function validateEnv(raw: Record<string, unknown>): AppConfig {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = result.data;
  // Purpose tokens (MFA challenge, reset links) are signed with the refresh secret and access
  // tokens with the access secret; sharing one key would let either be swapped for the other.
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values');
  }
  if (env.NODE_ENV === 'production') {
    for (const [name, value] of [
      ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
      ['ENCRYPTION_KEY', env.ENCRYPTION_KEY],
    ] as const) {
      if (value.startsWith('change-me') || KNOWN_EXAMPLE_SECRETS.has(value.trim())) {
        throw new Error(`${name} still has its placeholder value; refusing to start in production`);
      }
    }
    for (const [name, value] of [
      ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
    ] as const) {
      if (isLowEntropySecret(value)) {
        throw new Error(`${name} is not random enough; generate it with "openssl rand -base64 48"`);
      }
    }
    if (isDegenerateKey(decodeEncryptionKey(env.ENCRYPTION_KEY))) {
      throw new Error(
        'ENCRYPTION_KEY is not random enough; generate it with "openssl rand -base64 32"',
      );
    }
  }
  return {
    ...env,
    databaseRuntimeUrl: env.DATABASE_POOL_URL ?? env.DATABASE_URL,
    jwtAccessTtlSeconds: parseDurationSeconds(env.JWT_ACCESS_TTL),
    jwtRefreshTtlSeconds: parseDurationSeconds(env.JWT_REFRESH_TTL),
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
  };
}
