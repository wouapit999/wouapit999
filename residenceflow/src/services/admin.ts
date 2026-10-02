import "server-only";
import type { Prisma, Role } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { db, type Tx } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { can, type AuthContext } from "@/lib/auth/context";
import { PLATFORM_ONLY, POWERFUL_PERMISSIONS, isPermission, type Permission } from "@/lib/permissions";

export const ROLES_MANAGE: Permission = "settings.roles.manage";
export const ORG_ADMIN_ROLE_KEY = "org_admin";
export const LAST_ADMIN_MESSAGE =
  "This change would leave the organization without any active administrator able to manage roles.";

/** Admin pages operate on the caller's organization only; platform accounts have none. */
export function requireOrgId(ctx: AuthContext): string {
  if (!ctx.organizationId) throw new BusinessError("This action requires an organization account.");
  return ctx.organizationId;
}

/** Serializes administrator-affecting changes per organization (transaction-scoped advisory lock). */
export async function lockOrgAdmin(tx: Tx, organizationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`admin:${organizationId}`}))`;
}

type RoleLite = Pick<Role, "id" | "active" | "archived" | "permissions">;

export interface AdminChange {
  /** Users about to be suspended / archived / deactivated. */
  excludeUserIds?: string[];
  /** A user's complete new role set. */
  userRoles?: { userId: string; roleIds: string[] };
  /** A role about to change (permissions, activation or archive). */
  role?: { id: string; permissions?: string[]; active?: boolean; archived?: boolean };
}

/** Number of ACTIVE users of the organization who hold settings.roles.manage after `change`. */
export async function countActiveAdmins(organizationId: string, change: AdminChange = {}, tx: Tx = db) {
  const roleSelect = { id: true, active: true, archived: true, permissions: true } as const;
  const users = await tx.user.findMany({
    where: { organizationId, status: "ACTIVE" },
    select: { id: true, roles: { select: { role: { select: roleSelect } } } },
  });
  const replacement: RoleLite[] = change.userRoles
    ? await tx.role.findMany({ where: { id: { in: change.userRoles.roleIds }, organizationId }, select: roleSelect })
    : [];
  const effective = (r: RoleLite): RoleLite => {
    if (!change.role || change.role.id !== r.id) return r;
    return {
      ...r,
      permissions: change.role.permissions ?? r.permissions,
      active: change.role.active ?? r.active,
      archived: change.role.archived ?? r.archived,
    };
  };
  let count = 0;
  for (const u of users) {
    if (change.excludeUserIds?.includes(u.id)) continue;
    const roles = change.userRoles?.userId === u.id ? replacement : u.roles.map((x) => x.role);
    if (roles.map(effective).some((r) => r.active && !r.archived && r.permissions.includes(ROLES_MANAGE))) count++;
  }
  return count;
}

/** Final-admin lockout protection: refuses any change that removes the last active role manager. */
export async function assertNotLastAdmin(organizationId: string, change: AdminChange, tx: Tx = db) {
  const before = await countActiveAdmins(organizationId, {}, tx);
  if (before === 0) return; // nothing to protect (e.g. brand-new org still being set up)
  const after = await countActiveAdmins(organizationId, change, tx);
  if (after === 0) throw new BusinessError(LAST_ADMIN_MESSAGE);
}

export function isPowerful(permissions: string[]) {
  return permissions.some((p) => (POWERFUL_PERMISSIONS as string[]).includes(p));
}

/**
 * Validates a role assignment change. Roles must belong to the organization and be active; roles
 * with platform permissions are never assignable; granting or removing roles that carry powerful
 * permissions requires settings.roles.manage.
 */
export async function validateRoleAssignment(ctx: AuthContext, newRoleIds: string[], currentRoleIds: string[] = [], tx: Tx = db) {
  const organizationId = requireOrgId(ctx);
  const unique = [...new Set(newRoleIds)];
  const roles = await tx.role.findMany({ where: { id: { in: unique }, organizationId, active: true, archived: false } });
  const keep = new Set(currentRoleIds);
  // Already-held roles may stay even if they were deactivated later.
  const missing = unique.filter((id) => !roles.some((r) => r.id === id) && !keep.has(id));
  if (missing.length) throw new BusinessError("One or more selected roles are invalid or inactive.");
  const changed = [...unique.filter((id) => !keep.has(id)), ...currentRoleIds.filter((id) => !unique.includes(id))];
  const changedRoles = await tx.role.findMany({ where: { id: { in: changed }, organizationId } });
  for (const r of changedRoles) {
    if (r.scope === "PLATFORM" || r.permissions.some((p) => (PLATFORM_ONLY as string[]).includes(p))) {
      throw new BusinessError(`The role "${r.name}" cannot be assigned.`);
    }
    if (isPowerful(r.permissions) && !can(ctx, ROLES_MANAGE)) {
      throw new BusinessError(`Only role administrators can grant or remove the role "${r.name}" (it contains powerful permissions).`);
    }
  }
  return unique;
}

/** Keeps only known, organization-grantable permissions; enforces the org_admin invariant. */
export function sanitizeRolePermissions(roleKey: string, requested: string[]): string[] {
  const out = [...new Set(requested)].filter((p) => isPermission(p) && !(PLATFORM_ONLY as string[]).includes(p));
  if (roleKey === ORG_ADMIN_ROLE_KEY && !out.includes(ROLES_MANAGE)) {
    throw new BusinessError("The Organization Administrator role must keep the settings.roles.manage permission.");
  }
  return out.sort();
}

export async function validatePropertyIds(organizationId: string, ids: string[], tx: Tx = db) {
  const unique = [...new Set(ids)];
  if (!unique.length) return unique;
  const n = await tx.property.count({ where: { organizationId, id: { in: unique } } });
  if (n !== unique.length) throw new BusinessError("One or more selected buildings are invalid.");
  return unique;
}

export interface InviteInput {
  name: string;
  email: string;
  username?: string | null;
  phone?: string | null;
  roleIds: string[];
  propertyIds: string[];
  locale?: string | null;
}

/** Creates an INVITED user (no password) with roles and building scopes. Call inside a transaction. */
export async function createInvitedUser(ctx: AuthContext, input: InviteInput, tx: Tx) {
  const organizationId = requireOrgId(ctx);
  const roleIds = await validateRoleAssignment(ctx, input.roleIds, [], tx);
  const propertyIds = await validatePropertyIds(organizationId, input.propertyIds, tx);
  const email = input.email.trim().toLowerCase();
  const existing = await tx.user.findFirst({
    where: { OR: [{ email }, ...(input.username ? [{ username: input.username.toLowerCase() }] : [])] },
    select: { id: true },
  });
  if (existing) throw new BusinessError("A user with this email or username already exists.");
  const user = await tx.user.create({
    data: {
      organizationId,
      email,
      username: input.username ? input.username.toLowerCase() : null,
      name: input.name,
      phone: input.phone || null,
      locale: input.locale ?? null,
      status: "INVITED",
      roles: { create: roleIds.map((roleId) => ({ roleId })) },
      propertyScopes: { create: propertyIds.map((propertyId) => ({ propertyId })) },
    },
  });
  await audit(ctx, {
    action: "user.invited",
    module: "users",
    entityType: "User",
    entityId: user.id,
    after: { name: user.name, email: user.email, username: user.username, roleIds, propertyIds },
  }, tx);
  return user;
}

/**
 * Updates the organization settings and audits only the fields that changed (before/after).
 * Image data URLs are masked by sanitizeForAudit.
 */
export async function saveOrgSettings(
  ctx: AuthContext,
  data: Prisma.OrganizationSettingsUpdateInput,
  action: string,
) {
  const organizationId = requireOrgId(ctx);
  const current = await db.organizationSettings.findUnique({ where: { organizationId } });
  if (!current) throw new BusinessError("Organization settings not found.");
  const norm = (v: unknown) => (v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const old = (current as Record<string, unknown>)[k];
    if (norm(old) !== norm(v)) {
      // Policy numbers such as passwordMinLength are not secrets; avoid the sanitizer's key mask.
      const key = k.replace(/password/i, "pw");
      before[key] = old;
      after[key] = v;
    }
  }
  await db.$transaction(async (tx) => {
    await tx.organizationSettings.update({ where: { organizationId }, data });
    await audit(ctx, {
      action,
      module: "settings",
      entityType: "OrganizationSettings",
      entityId: current.id,
      metadata: { changed: Object.keys(after) },
      before,
      after,
    }, tx);
  });
  return Object.keys(after).length;
}

/** Loads a user of the caller's organization or throws (never exposes other organizations' users). */
export async function findOrgUser(ctx: AuthContext, userId: string, tx: Tx = db) {
  const organizationId = requireOrgId(ctx);
  const user = await tx.user.findFirst({
    where: { id: userId, organizationId },
    include: { roles: { include: { role: true } }, propertyScopes: true },
  });
  if (!user) throw new BusinessError("User not found.");
  return user;
}

/**
 * Privilege-escalation guard: only role administrators may act on accounts that hold powerful
 * permissions (e.g. send them a reset link, suspend them, reset their MFA).
 */
export function assertCanManageTarget(ctx: AuthContext, target: { id: string; roles: { role: { permissions: string[] } }[] }) {
  if (target.id === ctx.user.id) return;
  if (can(ctx, ROLES_MANAGE)) return;
  if (target.roles.some((r) => isPowerful(r.role.permissions))) {
    throw new BusinessError("Only role administrators can manage an account that holds powerful permissions.");
  }
}

export interface AuditFilters {
  actor?: string;
  from?: string;
  to?: string;
  module?: string;
  action?: string;
  entityId?: string;
  result?: string;
}

/** Builds the audit-log query for the caller's organization (dates interpreted in the org timezone). */
export function auditWhere(organizationId: string, f: AuditFilters, timezone = "UTC"): Prisma.AuditLogWhereInput {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const createdAt: Prisma.DateTimeFilter = {};
  if (f.from && day.test(f.from)) createdAt.gte = fromZonedTime(`${f.from}T00:00:00`, timezone);
  if (f.to && day.test(f.to)) createdAt.lt = new Date(fromZonedTime(`${f.to}T00:00:00`, timezone).getTime() + 86_400_000);
  return {
    organizationId: organizationId || "__none__",
    ...(f.actor ? { actorName: { contains: f.actor.slice(0, 100), mode: "insensitive" } } : {}),
    ...(f.module ? { module: f.module.slice(0, 60) } : {}),
    ...(f.action ? { action: { contains: f.action.slice(0, 100), mode: "insensitive" } } : {}),
    ...(f.entityId ? { entityId: f.entityId.trim().slice(0, 100) } : {}),
    ...(f.result && ["SUCCESS", "FAILURE", "DENIED"].includes(f.result) ? { result: f.result } : {}),
    ...(createdAt.gte || createdAt.lt ? { createdAt } : {}),
  };
}

/**
 * Audit actor for contexts that may have no organization (platform accounts have
 * organizationId ""), so the log row gets a NULL organization instead of an invalid FK.
 */
export function auditActor(ctx: AuthContext): Pick<AuthContext, "organizationId" | "user"> {
  return { organizationId: (ctx.organizationId || null) as unknown as string, user: ctx.user };
}
