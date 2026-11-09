/**
 * Feature flag keys: dot-separated, lowercase kebab-case segments (`area.feature[.variant]`).
 * Flags are stored in the `FeatureFlag` table and evaluated per realm; defaults below apply
 * when a flag row is missing.
 */
export const FEATURE_FLAG_KEYS = [
  'auth.registration.open',
  'auth.mfa.totp',
  'auth.mfa.enforce-admin',
  'auth.password-reset',
  'notifications.email',
  'notifications.sms',
  'notifications.push',
  'admin.audit.export',
  'admin.users.impersonation',
  'portal.maintenance-banner',
  'portal.new-dashboard',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

export const FEATURE_FLAG_KEY_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

export const FEATURE_FLAG_DEFAULTS: Readonly<Record<FeatureFlagKey, boolean>> = {
  'auth.registration.open': true,
  'auth.mfa.totp': true,
  'auth.mfa.enforce-admin': true,
  'auth.password-reset': true,
  'notifications.email': true,
  'notifications.sms': false,
  'notifications.push': false,
  'admin.audit.export': false,
  'admin.users.impersonation': false,
  'portal.maintenance-banner': false,
  'portal.new-dashboard': false,
};

export function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return (FEATURE_FLAG_KEYS as readonly string[]).includes(value);
}

/** Platform settings (`Setting` table) with well-known keys. */
export const SETTING_KEYS = [
  'auth.access-token-ttl',
  'auth.refresh-token-ttl',
  'auth.max-failed-logins',
  'auth.lockout-minutes',
  'auth.password-min-length',
  'notifications.default-locale',
  'notifications.sender-email',
  'platform.support-email',
  'platform.maintenance-message',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTING_KEY_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
