import { z } from 'zod';

/**
 * Environment variables, validated once (lazily) with Zod.
 *
 * `getEnv()` is lazy on purpose: nothing is read at import time, so `next build`, `prisma
 * generate` and unit tests can import server modules without a full environment.
 */

const DEV_AUTH_SECRET = 'dev-only-auth-secret-change-me-0123456789abcdef';
/** base64 of 32 fixed bytes — development / test only, never used in production. */
const DEV_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  VERCEL: z.string().optional(),
  VERCEL_ENV: z.string().optional(),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).optional(),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters').optional(),
  ENCRYPTION_KEY: z.string().min(1).optional(),
  ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(9999).optional(),
  ENCRYPTION_KEYS_PREVIOUS: z.string().optional(),
  SEED_ADMIN_EMAIL: z.email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(10).optional(),
  SEED_DEMO_DATA: booleanFromString.optional(),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).optional(),
});

export interface Env {
  readonly nodeEnv: 'development' | 'test' | 'production';
  /**
   * True for `NODE_ENV=production` and for every Vercel build or deployment — production **and
   * preview** (anything but `vercel dev`). A preview deployment is reachable from the internet and
   * may be attached to a real database, so it gets the production rules: secrets are mandatory,
   * the public seed password is refused and demo data is opt-in.
   */
  readonly isProduction: boolean;
  readonly databaseUrl: string;
  /** Direct URL for migrations/seed; falls back to `databaseUrl`. */
  readonly databaseUrlUnpooled: string;
  readonly databasePoolMax: number;
  readonly authSecret: string;
  /** Current AES-256-GCM key (32 bytes). */
  readonly encryptionKey: Buffer;
  readonly encryptionKeyVersion: number;
  /** Older keys by version, still accepted for decryption. */
  readonly previousEncryptionKeys: ReadonlyMap<number, Buffer>;
  readonly seedAdminEmail: string;
  readonly seedAdminPassword: string;
  /** False when the default password is in use (the seed refuses that in production). */
  readonly seedAdminPasswordProvided: boolean;
  readonly seedDemoData: boolean;
  readonly appName: string;
}

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

function decodeKey(value: string, label: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new EnvError(`${label} must be 32 bytes, base64-encoded (got ${key.length} bytes)`);
  }
  return key;
}

function parsePreviousKeys(raw: string | undefined): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  if (!raw) return keys;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EnvError('ENCRYPTION_KEYS_PREVIOUS must be JSON like {"1":"<base64 key>"}');
  }
  const record = z.record(z.string().regex(/^\d+$/), z.string()).safeParse(parsed);
  if (!record.success) {
    throw new EnvError('ENCRYPTION_KEYS_PREVIOUS must be JSON like {"1":"<base64 key>"}');
  }
  for (const [version, value] of Object.entries(record.data)) {
    keys.set(Number(version), decodeKey(value, `ENCRYPTION_KEYS_PREVIOUS[${version}]`));
  }
  return keys;
}

let warned = false;

/** Parses `source` (defaults to `process.env`). Exported for tests. */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  // Empty strings (a blank line in .env) count as "not set".
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = rawSchema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new EnvError(`Invalid environment: ${issues}`);
  }
  const raw = result.data;
  const nodeEnv = raw.NODE_ENV ?? 'development';
  const onVercel =
    raw.VERCEL_ENV === 'production' ||
    raw.VERCEL_ENV === 'preview' ||
    (raw.VERCEL === '1' && raw.VERCEL_ENV !== 'development');
  const isProduction = nodeEnv === 'production' || onVercel;

  if (!raw.DATABASE_URL) {
    throw new EnvError('DATABASE_URL is required');
  }

  const missing: string[] = [];
  if (!raw.AUTH_SECRET) missing.push('AUTH_SECRET');
  if (!raw.ENCRYPTION_KEY) missing.push('ENCRYPTION_KEY');
  if (isProduction && missing.length > 0) {
    throw new EnvError(`${missing.join(' and ')} must be set in production`);
  }
  // The development fallbacks are public (they are in the repository): setting them explicitly
  // in production would make every session forgeable and every stored secret decryptable.
  if (isProduction && raw.AUTH_SECRET === DEV_AUTH_SECRET) {
    throw new EnvError('AUTH_SECRET is the public development value — generate a real secret');
  }
  if (isProduction && raw.ENCRYPTION_KEY === DEV_ENCRYPTION_KEY) {
    throw new EnvError('ENCRYPTION_KEY is the public development value — generate a real key');
  }
  if (missing.length > 0 && nodeEnv !== 'test' && !warned) {
    warned = true;
    console.warn(
      `[bi-rem-lite] ${missing.join(' and ')} not set — using fixed DEVELOPMENT values. Never do this in production.`,
    );
  }

  return {
    nodeEnv,
    isProduction,
    databaseUrl: raw.DATABASE_URL,
    databaseUrlUnpooled: raw.DATABASE_URL_UNPOOLED ?? raw.DATABASE_URL,
    databasePoolMax: raw.DATABASE_POOL_MAX ?? 5,
    authSecret: raw.AUTH_SECRET ?? DEV_AUTH_SECRET,
    encryptionKey: decodeKey(raw.ENCRYPTION_KEY ?? DEV_ENCRYPTION_KEY, 'ENCRYPTION_KEY'),
    encryptionKeyVersion: raw.ENCRYPTION_KEY_VERSION ?? 1,
    previousEncryptionKeys: parsePreviousKeys(raw.ENCRYPTION_KEYS_PREVIOUS),
    seedAdminEmail: (raw.SEED_ADMIN_EMAIL ?? 'admin@bi-rem.local').toLowerCase(),
    seedAdminPassword: raw.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!',
    seedAdminPasswordProvided: raw.SEED_ADMIN_PASSWORD !== undefined,
    seedDemoData: raw.SEED_DEMO_DATA ?? !isProduction,
    appName: raw.NEXT_PUBLIC_APP_NAME ?? 'BI-Rem Lite',
  };
}

let cached: Env | undefined;

/** Validated environment (memoised). */
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

/** Test helper: forget the memoised environment after mutating `process.env`. */
export function resetEnvCache(): void {
  cached = undefined;
}
