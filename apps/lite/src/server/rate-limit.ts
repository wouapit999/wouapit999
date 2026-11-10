import { db } from './db';
import { getEnv } from './env';
import { AppError } from './errors';

/**
 * Database-backed fixed-window rate limiter (no Redis in Lite). One atomic upsert per hit, so
 * it is safe across serverless instances.
 */

export interface RateLimitRule {
  /** Maximum hits per window. */
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export const RATE_LIMITS = {
  /** Login attempts per IP. */
  loginPerIp: { limit: 20, windowSeconds: 300 },
  /** Login attempts per e-mail (on top of the 5-failure account lockout). */
  loginPerEmail: { limit: 10, windowSeconds: 300 },
  registerPerIp: { limit: 10, windowSeconds: 3600 },
  partnerApplicationPerIp: { limit: 5, windowSeconds: 3600 },
  /** Public REST API, per API key. */
  apiPerKey: { limit: 120, windowSeconds: 60 },
  /** Inbound provider webhooks, per provider. */
  webhookPerProvider: { limit: 600, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

interface BucketRow {
  count: number;
  window_start: Date;
}

/** Records one hit on `key` and reports whether it is within the limit. */
export async function hitRateLimit(
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const expiresAt = new Date(windowStart.getTime() + windowMs);
  const rows = await db.$queryRaw<BucketRow[]>`
    INSERT INTO rate_limit_buckets (key, count, window_start, expires_at)
    VALUES (${key}, 1, ${windowStart}, ${expiresAt})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit_buckets.window_start = EXCLUDED.window_start
                   THEN rate_limit_buckets.count + 1 ELSE 1 END,
      window_start = EXCLUDED.window_start,
      expires_at = EXCLUDED.expires_at
    RETURNING count, window_start`;
  const count = rows[0]?.count ?? 1;
  return {
    allowed: count <= rule.limit,
    remaining: Math.max(rule.limit - count, 0),
    retryAfterSeconds: Math.max(Math.ceil((expiresAt.getTime() - now.getTime()) / 1000), 1),
  };
}

/** Development / test relaxation so local e2e suites that sign in repeatedly are not throttled. */
const NON_PRODUCTION_FACTOR = 20;

/**
 * Like {@link hitRateLimit} but throws `RATE_LIMITED` when the limit is exceeded. Outside
 * production the limit is multiplied by 20 unless `RATE_LIMIT_STRICT=1`.
 */
export async function enforceRateLimit(key: string, rule: RateLimitRule): Promise<void> {
  const strict = getEnv().isProduction || process.env.RATE_LIMIT_STRICT === '1';
  const effective = strict ? rule : { ...rule, limit: rule.limit * NON_PRODUCTION_FACTOR };
  const result = await hitRateLimit(key, effective);
  if (!result.allowed) {
    throw new AppError('RATE_LIMITED', 'Too many attempts. Please wait a moment and try again.', {
      details: { retryAfterSeconds: result.retryAfterSeconds },
    });
  }
}

/** Housekeeping: drop expired buckets (called opportunistically from the health endpoint). */
export async function purgeExpiredRateLimits(now: Date = new Date()): Promise<number> {
  const result = await db.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } });
  return result.count;
}
