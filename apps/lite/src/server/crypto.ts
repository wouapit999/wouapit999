import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

import { getEnv } from './env';
import { AppError } from './errors';

/**
 * Cryptography for BI-Rem Lite — Node `crypto` only, no native modules.
 *
 * - Secrets at rest (provider credentials, webhook secrets, TOTP secrets): AES-256-GCM with a
 *   versioned key. Envelope: `v<keyVersion>.<iv>.<tag>.<ciphertext>` (base64url parts).
 * - Passwords: scrypt, `scrypt$N$r$p$<salt b64>$<hash b64>`.
 * - API keys / tokens: random, stored as sha256.
 * - Webhooks: HMAC-SHA256 over `<timestamp>.<body>`, header `t=<unix>,v1=<hex>`.
 */

// ---------------------------------------------------------------------------
// AES-256-GCM with key versioning
// ---------------------------------------------------------------------------

const ENVELOPE_PATTERN = /^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/;

function keyForVersion(version: number): Buffer {
  const env = getEnv();
  if (version === env.encryptionKeyVersion) return env.encryptionKey;
  const previous = env.previousEncryptionKeys.get(version);
  if (!previous) {
    throw new AppError('INTERNAL', `No encryption key available for key version ${version}`);
  }
  return previous;
}

/** Encrypts `plaintext` with the current key. The result is safe to store in a text column. */
export function encryptSecret(plaintext: string): string {
  const env = getEnv();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', env.encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    `v${env.encryptionKeyVersion}`,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/** Decrypts an envelope produced by {@link encryptSecret} (any still-configured key version). */
export function decryptSecret(envelope: string): string {
  const match = ENVELOPE_PATTERN.exec(envelope);
  if (!match) throw new AppError('INTERNAL', 'Malformed secret envelope');
  const [, version = '', iv = '', tag = '', ciphertext = ''] = match;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyForVersion(Number(version)),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new AppError('INTERNAL', 'Secret could not be decrypted (wrong key or tampered data)');
  }
}

/** Key version an envelope was written with (for rotation tooling and the admin UI). */
export function secretKeyVersion(envelope: string): number {
  const match = ENVELOPE_PATTERN.exec(envelope);
  if (!match) throw new AppError('INTERNAL', 'Malformed secret envelope');
  return Number(match[1]);
}

/** Re-encrypts with the current key when the envelope uses an older key version. */
export function reencryptSecret(envelope: string): string {
  return secretKeyVersion(envelope) === getEnv().encryptionKeyVersion
    ? envelope
    : encryptSecret(decryptSecret(envelope));
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------------

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password.normalize('NFKC'),
      salt,
      SCRYPT_KEY_LENGTH,
      { N: n, r, p, maxmem: 64 * 1024 * 1024 },
      (error, derived) => {
        if (error) reject(error);
        else resolve(derived);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const derived = await scrypt(
    password,
    Buffer.from(salt, 'base64'),
    Number(n),
    Number(r),
    Number(p),
  );
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

/** A valid hash of a random password — verify against it to equalise timing for unknown users. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(18).toString('base64'));
  return dummyHash;
}

// ---------------------------------------------------------------------------
// Tokens, hashing, HMAC
// ---------------------------------------------------------------------------

export const sha256Hex = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

/** URL-safe random token (`bytes` of entropy). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Hash under which an API key / opaque token is stored and looked up. */
export const hashToken = (token: string): string => sha256Hex(token);

export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const hmacSha256Hex = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(payload).digest('hex');

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Random Crockford base32 string (no I, L, O, U) for human-facing references. */
export function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += CROCKFORD[byte % 32];
  return out;
}

// ---------------------------------------------------------------------------
// Webhook signatures: `t=<unix seconds>,v1=<hex hmac-sha256("<t>.<body>")>`
// ---------------------------------------------------------------------------

export const WEBHOOK_SIGNATURE_HEADER = 'x-birem-signature';
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function signWebhookPayload(secret: string, body: string, at: Date = new Date()): string {
  const timestamp = Math.floor(at.getTime() / 1000);
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

export type WebhookVerification =
  { ok: true; timestamp: number } | { ok: false; reason: 'MALFORMED' | 'EXPIRED' | 'MISMATCH' };

/**
 * Verifies a signature header against one or more candidate secrets (current + previous during
 * a rotation grace period). Rejects timestamps outside the tolerance window (replay defence —
 * event ids are additionally de-duplicated in the database).
 */
export function verifyWebhookSignature(
  secrets: string | readonly string[],
  body: string,
  header: string | null | undefined,
  options: { toleranceSeconds?: number; now?: Date } = {},
): WebhookVerification {
  if (!header) return { ok: false, reason: 'MALFORMED' };
  const parts = new Map(
    header.split(',').map((part) => {
      const index = part.indexOf('=');
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()] as const;
    }),
  );
  const timestampText = parts.get('t');
  const signature = parts.get('v1');
  if (
    !timestampText ||
    !signature ||
    !/^\d{1,12}$/.test(timestampText) ||
    !/^[0-9a-f]{64}$/.test(signature)
  ) {
    return { ok: false, reason: 'MALFORMED' };
  }
  const timestamp = Number(timestampText);
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: 'EXPIRED' };
  const candidates = typeof secrets === 'string' ? [secrets] : secrets;
  const matches = candidates.some((secret) =>
    timingSafeEqualString(hmacSha256Hex(secret, `${timestamp}.${body}`), signature),
  );
  return matches ? { ok: true, timestamp } : { ok: false, reason: 'MISMATCH' };
}
