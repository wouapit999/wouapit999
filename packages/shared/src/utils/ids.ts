/** RFC 4122 UUID (any version), lowercase or uppercase hex. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Header carrying the correlation id, accepted from clients and echoed back. */
export const CORRELATION_ID_HEADER = 'x-request-id';

/** Opaque correlation ids clients may supply: safe printable characters, 8–128 chars. */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Crockford-style alphabet without look-alike characters (0/O, 1/I/L). */
const HUMAN_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateId(): string {
  return crypto.randomUUID();
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Returns a trustworthy correlation id for a request: the inbound header value when it is
 * well-formed, otherwise a fresh UUID. Multi-valued headers use the first entry.
 */
export function resolveCorrelationId(
  headerValue: string | readonly string[] | undefined | null,
): string {
  const candidate = typeof headerValue === 'string' ? headerValue : headerValue?.[0];
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (CORRELATION_ID_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }
  return generateCorrelationId();
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** URL-safe base64 of `byteLength` random bytes — for refresh tokens, reset tokens, API keys. */
export function generateOpaqueToken(byteLength = 32): string {
  if (!Number.isInteger(byteLength) || byteLength < 16) {
    throw new RangeError('Opaque tokens need at least 16 random bytes');
  }
  const bytes = randomBytes(byteLength);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Short, human-readable reference (`TRX-7K3M9QW2AB`) for support conversations and receipts.
 * Uses rejection sampling so every character is uniformly distributed.
 */
export function generateHumanReference(prefix: string, length = 10): string {
  if (!/^[A-Z]{2,6}$/.test(prefix)) {
    throw new RangeError('Reference prefix must be 2–6 uppercase letters');
  }
  if (!Number.isInteger(length) || length < 6 || length > 32) {
    throw new RangeError('Reference length must be between 6 and 32');
  }
  const alphabetSize = HUMAN_ALPHABET.length;
  const limit = 256 - (256 % alphabetSize);
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < limit && out.length < length) {
        out += HUMAN_ALPHABET.charAt(byte % alphabetSize);
      }
    }
  }
  return `${prefix}-${out}`;
}
