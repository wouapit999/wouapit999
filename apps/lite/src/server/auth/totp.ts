import { createHmac, randomBytes } from 'node:crypto';

import { timingSafeEqualString } from '../crypto';

/**
 * Minimal RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30-second step) — compatible with Google
 * Authenticator, Authy, 1Password… No dependency, ~60 lines, covered by RFC test vectors.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** New random 160-bit secret, base32 encoded. */
export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

/** HOTP value for a counter (RFC 4226). */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** TOTP code for `secret` (base32) at `at`. */
export function totpCode(secret: string, at: Date = new Date(), digits = TOTP_DIGITS): string {
  const counter = Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
  return hotp(base32Decode(secret), counter, digits);
}

/**
 * The time-step counter `code` is valid for (the current step and `window` steps either side,
 * for clock drift), or null. The caller can remember the counter to refuse a second use.
 */
export function matchTotpCounter(
  secret: string,
  code: string,
  options: { at?: Date; window?: number } = {},
): number | null {
  const candidate = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return null;
  const at = options.at ?? new Date();
  const window = options.window ?? 1;
  const key = base32Decode(secret);
  const counter = Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
  let matched: number | null = null;
  for (let offset = -window; offset <= window; offset += 1) {
    // No early exit: keep the comparison count constant.
    if (timingSafeEqualString(hotp(key, counter + offset), candidate)) matched = counter + offset;
  }
  return matched;
}

/** Accepts the current step and `window` steps either side (clock drift). */
export function verifyTotp(
  secret: string,
  code: string,
  options: { at?: Date; window?: number } = {},
): boolean {
  return matchTotpCounter(secret, code, options) !== null;
}

/** `otpauth://` URI for QR codes / manual entry. */
export function totpAuthUri(secret: string, accountName: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
