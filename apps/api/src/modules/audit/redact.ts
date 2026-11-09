// `mfaEnabled`-style booleans stay visible (useful in audit diffs); secrets, codes and tokens do not.
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|api[-_]?key|key[-_]?hash|mfa[-_]?(secret|code|token)|otp|cookie|credential|private[-_]?key)/i;

/**
 * Short-lived credentials whose key is too generic for a substring match: `code` is the TOTP
 * field of the MFA DTOs, but `countryCode` must stay visible. Matched on the whole key only.
 */
const SENSITIVE_EXACT_KEYS: ReadonlySet<string> = new Set([
  'code',
  'pin',
  'totp',
  'cvv',
  'cvc',
  'recoverycode',
  'backupcode',
]);

export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;
const MAX_STRING = 2_000;

/**
 * Deep-copies a JSON-like value while replacing the values of sensitive keys with a marker and
 * bounding depth/string length so audit rows stay small and never leak credentials.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > MAX_DEPTH) return '[TRUNCATED]';
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      out[key] = isSensitiveKey(key)
        ? entry === null
          ? null
          : REDACTED
        : redact(entry, depth + 1);
    }
    return out;
  }
  return typeof value === 'symbol' ? value.toString() : '[unsupported]';
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_EXACT_KEYS.has(key.toLowerCase());
}
