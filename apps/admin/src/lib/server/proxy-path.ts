/**
 * Validation of the `/api/proxy/[...path]` catch-all before it is forwarded upstream.
 *
 * Each segment is decoded, checked against a conservative allow-list (API paths are made of
 * resource names, UUIDs and dotted keys) and re-encoded, so a segment can never smuggle a `?`,
 * `#`, `..`, an empty segment or an absolute URL into the upstream request line, and the
 * blocked session endpoints cannot be reached through `//` or `./` variants.
 */

/** Only the versioned API may be reached. */
const REQUIRED_PREFIX = 'v1';

/** Session endpoints must go through `/api/auth/*`, which owns the httpOnly cookies. */
const BLOCKED_PATHS: ReadonlySet<string> = new Set([
  'v1/auth/login',
  'v1/auth/admin/login',
  'v1/auth/register',
  'v1/auth/refresh',
  'v1/auth/logout',
  'v1/auth/mfa/verify',
  'v1/auth/password/reset/request',
  'v1/auth/password/reset/confirm',
]);

const SEGMENT_PATTERN = /^[A-Za-z0-9._~@:-]{1,128}$/;
const MAX_SEGMENTS = 16;

export type ProxyPathResult = { ok: true; path: string } | { ok: false };

export function resolveProxyPath(segments: readonly string[]): ProxyPathResult {
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) return { ok: false };

  const decoded: string[] = [];
  for (const segment of segments) {
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return { ok: false };
    }
    if (value === '.' || value === '..' || !SEGMENT_PATTERN.test(value)) {
      return { ok: false };
    }
    decoded.push(value);
  }

  if (decoded[0] !== REQUIRED_PREFIX || decoded.length < 2) return { ok: false };
  if (BLOCKED_PATHS.has(decoded.join('/'))) return { ok: false };

  return { ok: true, path: `/${decoded.map(encodeURIComponent).join('/')}` };
}
