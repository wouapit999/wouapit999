/**
 * Mirrors of the Prisma enums declared in `packages/db` schema v1. The database schema is the
 * source of truth; keep these lists in sync when the schema changes.
 */

export const USER_REALMS = ['CUSTOMER', 'ADMIN'] as const;
export type UserRealm = (typeof USER_REALMS)[number];

export const USER_STATUSES = [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'LOCKED',
  'DEACTIVATED',
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'PUSH', 'IN_APP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Functional grouping of notifications used by user preferences. */
export const NOTIFICATION_CATEGORIES = [
  'SECURITY',
  'TRANSACTIONAL',
  'SYSTEM',
  'MARKETING',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const AUDIT_OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export function isUserRealm(value: string): value is UserRealm {
  return (USER_REALMS as readonly string[]).includes(value);
}
