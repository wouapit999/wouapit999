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

/** Expands an IPv6 literal (any valid spelling, optional zone id) to its 8 groups, or null. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().split('%')[0] ?? '';
  // Embedded dotted IPv4 tail (`::ffff:127.0.0.1`) → two hex groups.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const octets = tail.slice(1, 5).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part
      .split(':')
      .map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN));
    return groups.some(Number.isNaN) ? null : groups;
  };
  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (!head || !rest) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

const embeddedIpv4 = (high: number, low: number): string =>
  `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;

/**
 * Private, loopback, link-local, multicast and documentation ranges — and every IPv6 form that
 * merely wraps an IPv4 address (IPv4-mapped `::ffff:a.b.c.d`, IPv4-compatible `::a.b.c.d`, NAT64
 * `64:ff9b::/96`, 6to4 `2002::/16`). `new URL()` rewrites `[::ffff:127.0.0.1]` to
 * `[::ffff:7f00:1]`, so matching on the dotted text is not enough: the address is parsed.
 */
function isPrivateIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return true; // unparseable: refuse rather than guess
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const leadingZeros = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (leadingZeros && g5 === 0) {
    // `::`, `::1` and IPv4-compatible `::a.b.c.d`.
    return g6 === 0 || isPrivateIpv4(embeddedIpv4(g6, g7));
  }
  if (leadingZeros && g5 === 0xffff) return isPrivateIpv4(embeddedIpv4(g6, g7));
  if (g0 === 0x64 && g1 === 0xff9b) return true; // NAT64 (wraps an IPv4 address)
  if (g0 === 0x2002) return true; // 6to4 (wraps an IPv4 address)
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return true; // Teredo, documentation
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0 & 0xffc0) === 0xfec0) return true; // site-local fec0::/10 (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  return false;
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
  // A fully-qualified name may end with a dot (`localhost.`); judge it without.
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  const local =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local');
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
