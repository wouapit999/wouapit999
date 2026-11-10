/**
 * Turns a User-Agent header into something a person recognises in a list of sessions
 * ("Chrome on Android"). Deliberately coarse: it is a label, never used for a decision.
 */
export function describeUserAgent(userAgent: string | null | undefined): string {
  const ua = userAgent?.trim() ?? '';
  if (ua === '') return 'Unknown device';

  const has = (...needles: string[]): boolean => needles.some((needle) => ua.includes(needle));

  // Order matters: Edge, Opera and Samsung Internet also announce "Chrome" and "Safari".
  const browser = has('Edg/', 'Edge/', 'EdgA/', 'EdgiOS/')
    ? 'Edge'
    : has('OPR/', 'Opera')
      ? 'Opera'
      : has('SamsungBrowser/')
        ? 'Samsung Internet'
        : has('Firefox/', 'FxiOS/')
          ? 'Firefox'
          : has('HeadlessChrome/')
            ? 'Chrome (headless)'
            : has('Chrome/', 'CriOS/')
              ? 'Chrome'
              : has('Safari/')
                ? 'Safari'
                : has('curl/')
                  ? 'curl'
                  : null;

  const system = has('Android')
    ? 'Android'
    : has('iPhone', 'iPad', 'iPod')
      ? 'iOS'
      : has('Windows')
        ? 'Windows'
        : has('Mac OS X', 'Macintosh')
          ? 'macOS'
          : has('CrOS')
            ? 'ChromeOS'
            : has('Linux')
              ? 'Linux'
              : null;

  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'Unknown device';
}

/** Splits a base32 secret into groups of four so it can be typed without mistakes. */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}
