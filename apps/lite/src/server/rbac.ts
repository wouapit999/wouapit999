import type { Role } from '@/generated/prisma/enums';

import { AppError } from './errors';

/**
 * Role-based access control. Permissions are `resource:action` strings; each role maps to a
 * fixed set. Every service function that mutates or reads privileged data calls
 * `assertPermission(ctx, …)` itself, so a missing check in a page or action cannot bypass it.
 */

export const PERMISSIONS = [
  // Areas
  'customer:access',
  'partner:access',
  'admin:access',
  // Phase 1–2
  'users:read',
  'users:write',
  'kyc:read',
  'kyc:review',
  'audit:read',
  'settings:write',
  // Phase 3–4, 13
  'providers:read',
  'providers:write',
  'providers:test',
  'countries:write',
  // Phase 5–7
  'transfers:read',
  'transfers:reverse',
  'transfers:refresh',
  'fees:read',
  'fees:write',
  'fx:read',
  'fx:write',
  'treasury:read',
  'treasury:write',
  // Phase 8
  'aml:read',
  'aml:write',
  'sar:write',
  'sanctions:write',
  // Phase 9
  'partners:read',
  'partners:write',
  'settlements:write',
  // Phase 10
  'reports:read',
  'reports:export',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const STAFF_ROLES = [
  'ADMIN',
  'COMPLIANCE',
  'TREASURY',
  'SUPPORT',
] as const satisfies readonly Role[];
export type StaffRole = (typeof STAFF_ROLES)[number];

const STAFF_READ: Permission[] = [
  'admin:access',
  'users:read',
  'kyc:read',
  'transfers:read',
  'providers:read',
  'partners:read',
  'fees:read',
  'fx:read',
  'reports:read',
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  CUSTOMER: ['customer:access'],
  PARTNER: ['partner:access'],
  ADMIN: PERMISSIONS.filter(
    (permission) => permission !== 'customer:access' && permission !== 'partner:access',
  ),
  COMPLIANCE: [
    ...STAFF_READ,
    'kyc:review',
    'aml:read',
    'aml:write',
    'sar:write',
    'sanctions:write',
    'audit:read',
    'reports:export',
  ],
  TREASURY: [
    ...STAFF_READ,
    'fees:write',
    'fx:write',
    'treasury:read',
    'treasury:write',
    'settlements:write',
    'transfers:refresh',
    'reports:export',
  ],
  SUPPORT: [...STAFF_READ, 'transfers:refresh', 'aml:read'],
};

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  CUSTOMER: 'Customer',
  PARTNER: 'Partner',
  ADMIN: 'Administrator',
  COMPLIANCE: 'Compliance officer',
  TREASURY: 'Treasury officer',
  SUPPORT: 'Support agent',
};

const permissionSets = new Map<Role, ReadonlySet<Permission>>(
  (Object.entries(ROLE_PERMISSIONS) as Array<[Role, readonly Permission[]]>).map(([role, list]) => [
    role,
    new Set(list),
  ]),
);

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return permissionSets.get(role)?.has(permission) ?? false;
}

export function isStaffRole(role: Role): role is StaffRole {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

/** Landing area for a role after login. */
export function homePathForRole(role: Role): '/app' | '/admin' | '/partner' {
  if (role === 'CUSTOMER') return '/app';
  if (role === 'PARTNER') return '/partner';
  return '/admin';
}

/** Which roles may enter an area (used by the proxy and the area layouts). */
export function canAccessPath(role: Role, pathname: string): boolean {
  if (pathname === '/app' || pathname.startsWith('/app/')) return role === 'CUSTOMER';
  if (pathname === '/partner' || pathname.startsWith('/partner/')) return role === 'PARTNER';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return isStaffRole(role);
  return true;
}

// ---------------------------------------------------------------------------
// Actors and action context
// ---------------------------------------------------------------------------

export interface UserActor {
  readonly type: 'USER';
  readonly id: string;
  readonly role: Role;
  /** E-mail, for audit rows. */
  readonly label: string;
  readonly partnerId: string | null;
}

export interface ApiKeyActor {
  readonly type: 'API_KEY';
  /** ApiKey id. */
  readonly id: string;
  readonly partnerId: string;
  readonly label: string;
  readonly scopes: readonly string[];
}

export interface SystemActor {
  readonly type: 'SYSTEM';
  readonly label: string;
}

export type Actor = UserActor | ApiKeyActor | SystemActor;

/** Who is acting and from where. First argument of every service function. */
export interface ActionContext {
  readonly actor: Actor;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
}

/** Context for trusted in-process callers (seed, webhooks, tests). Bypasses permission checks. */
export const systemContext = (label = 'system'): ActionContext => ({
  actor: { type: 'SYSTEM', label },
});

export function hasPermission(ctx: ActionContext, permission: Permission): boolean {
  switch (ctx.actor.type) {
    case 'SYSTEM':
      return true;
    case 'API_KEY':
      return permission === 'partner:access';
    case 'USER':
      return roleHasPermission(ctx.actor.role, permission);
  }
}

/** Throws FORBIDDEN unless the actor holds `permission`. */
export function assertPermission(ctx: ActionContext, permission: Permission): void {
  if (!hasPermission(ctx, permission)) {
    throw new AppError('FORBIDDEN', `Missing permission ${permission}`);
  }
}

export function assertAnyPermission(ctx: ActionContext, permissions: readonly Permission[]): void {
  if (!permissions.some((permission) => hasPermission(ctx, permission))) {
    throw new AppError('FORBIDDEN', `Missing permission ${permissions.join(' or ')}`);
  }
}

/** The acting user's id, or FORBIDDEN for API keys / system. */
export function requireUserActor(ctx: ActionContext): UserActor {
  if (ctx.actor.type !== 'USER') {
    throw new AppError('FORBIDDEN', 'This action requires a signed-in user');
  }
  return ctx.actor;
}

/** Id recorded in `created_by_id`-style columns (null for system / API keys). */
export const actorUserId = (ctx: ActionContext): string | null =>
  ctx.actor.type === 'USER' ? ctx.actor.id : null;

/** Partner the actor acts for (partner users and API keys), else null. */
export const actorPartnerId = (ctx: ActionContext): string | null =>
  ctx.actor.type === 'SYSTEM' ? null : ctx.actor.partnerId;

export const isSystem = (ctx: ActionContext): boolean => ctx.actor.type === 'SYSTEM';

/** True for back-office users (and the system actor). */
export const isStaff = (ctx: ActionContext): boolean =>
  ctx.actor.type === 'SYSTEM' || (ctx.actor.type === 'USER' && isStaffRole(ctx.actor.role));
