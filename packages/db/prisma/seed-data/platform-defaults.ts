import type { Prisma } from '../../src/index.js';

export interface SeedFeatureFlag {
  readonly key: string;
  readonly enabled: boolean;
  readonly rolloutPercentage: number;
  readonly rules: Prisma.InputJsonValue;
  readonly description: string;
}

export const FEATURE_FLAGS: readonly SeedFeatureFlag[] = [
  {
    key: 'customer.registration',
    enabled: true,
    rolloutPercentage: 100,
    rules: [],
    description: 'Allow new customers to self-register on the customer portal.',
  },
  {
    key: 'customer.mfa-required',
    enabled: false,
    rolloutPercentage: 100,
    rules: [],
    description: 'Force every customer to enrol a TOTP second factor at sign-in.',
  },
  {
    key: 'admin.mfa-required',
    enabled: true,
    rolloutPercentage: 100,
    rules: [],
    description: 'Force every admin-realm user to enrol a TOTP second factor at sign-in.',
  },
  {
    key: 'notifications.sms',
    enabled: false,
    rolloutPercentage: 100,
    rules: [],
    description: 'Dispatch SMS notifications (requires an SMS provider to be configured).',
  },
  {
    key: 'notifications.login-alert',
    enabled: true,
    rolloutPercentage: 100,
    rules: [],
    description: 'Send a login alert when a sign-in happens from a new device or location.',
  },
  {
    key: 'platform.maintenance-mode',
    enabled: false,
    rolloutPercentage: 100,
    rules: [],
    description: 'Reject non-admin traffic with HTTP 503 while maintenance is in progress.',
  },
];

export interface SeedSetting {
  readonly key: string;
  readonly value: Prisma.InputJsonValue;
  readonly isSecret: boolean;
  readonly description: string;
}

export const SETTINGS: readonly SeedSetting[] = [
  {
    key: 'platform.name',
    value: 'BI-Rem',
    isSecret: false,
    description: 'Display name used in notifications and portal titles.',
  },
  {
    key: 'platform.support-email',
    value: 'support@bi-rem.local',
    isSecret: false,
    description: 'Address shown to customers for support requests.',
  },
  {
    key: 'auth.max-failed-login-attempts',
    value: 5,
    isSecret: false,
    description: 'Failed sign-in attempts before an account is temporarily locked.',
  },
  {
    key: 'auth.lockout-minutes',
    value: 15,
    isSecret: false,
    description: 'Duration of the temporary lock after too many failed sign-ins.',
  },
  {
    key: 'auth.password-reset-ttl-minutes',
    value: 30,
    isSecret: false,
    description: 'Validity window of password-reset links and codes.',
  },
  {
    key: 'auth.mfa-code-ttl-minutes',
    value: 5,
    isSecret: false,
    description: 'Validity window of e-mail / SMS one-time codes.',
  },
  {
    key: 'notifications.default-locale',
    value: 'en',
    isSecret: false,
    description: 'Fallback locale when no template exists for the user locale.',
  },
];
