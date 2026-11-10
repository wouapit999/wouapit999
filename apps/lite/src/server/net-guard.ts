import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { getEnv } from './env';
import { AppError } from './errors';

/**
 * Outbound URL guard (SSRF defence) for admin/partner-supplied URLs: provider base URLs and
 * partner webhook endpoints. In production only public HTTPS hosts are allowed; in development
 * and tests plain HTTP to localhost is tolerated so local receivers can be used.
 */

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('::ffff:')) return isPrivateIpv4(lower.slice(7));
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return false;
}

/** Syntax-level validation (no DNS). Returns the parsed URL or throws `VALIDATION`. */
export function parseOutboundUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('VALIDATION', 'Enter a valid URL');
  }
  const production = getEnv().isProduction;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production)) {
    throw new AppError('VALIDATION', 'URL must use https://');
  }
  if (url.username || url.password) {
    throw new AppError('VALIDATION', 'URL must not contain credentials');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal');
  if (production && (local || isPrivateAddress(host))) {
    throw new AppError('VALIDATION', 'URL must point to a public host');
  }
  return url;
}

/**
 * Full check right before a request: syntax plus DNS resolution, rejecting hosts that resolve to
 * private / loopback / link-local addresses in production.
 */
export async function assertSafeOutboundUrl(raw: string): Promise<URL> {
  const url = parseOutboundUrl(raw);
  if (!getEnv().isProduction) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return url; // already vetted by parseOutboundUrl
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new AppError('VALIDATION', 'Host name could not be resolved');
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new AppError('VALIDATION', 'URL must point to a public host');
  }
  return url;
}
