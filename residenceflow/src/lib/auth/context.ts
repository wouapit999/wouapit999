import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  broadestScope,
  hasPermission,
  type Permission,
  type RoleScopeValue,
} from "@/lib/permissions";
import { readSession } from "./session";
import { ForbiddenError } from "@/lib/errors";

export interface AuthContext {
  sessionId: string;
  user: {
    id: string;
    name: string;
    email: string;
    locale: string | null;
    mustChangePassword: boolean;
    isPlatformAdmin: boolean;
    mfaEnabled: boolean;
  };
  organizationId: string;
  permissions: ReadonlySet<string>;
  roleKeys: string[];
  scope: RoleScopeValue;
  /** "ALL" for organization-wide users, otherwise the assigned building IDs. */
  propertyIds: "ALL" | string[];
  tenantId: string | null;
  vendorId: string | null;
}

export { ForbiddenError };

/** Loads the authenticated user, roles and scope once per request. */
export const getContext = cache(async (): Promise<AuthContext | null> => {
  const session = await readSession();
  if (!session || session.mfaPending) return null;
  const user = session.user;
  if (user.status !== "ACTIVE") return null;

  const roles = await db.userRole.findMany({
    where: { userId: user.id, role: { active: true, archived: false } },
    include: { role: true },
  });
  const permissions = new Set<string>();
  for (const r of roles) for (const p of r.role.permissions) permissions.add(p);
  const scope = broadestScope(roles.map((r) => r.role.scope as RoleScopeValue));

  let propertyIds: "ALL" | string[] = [];
  if (scope === "ORGANIZATION" || scope === "PLATFORM") propertyIds = "ALL";
  else if (scope === "ASSIGNED_BUILDINGS" || scope === "ASSIGNED_UNITS") {
    const scopes = await db.userPropertyScope.findMany({ where: { userId: user.id } });
    propertyIds = scopes.map((s) => s.propertyId);
  }

  // Sliding session: refresh lastSeenAt at most once a minute.
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }

  return {
    sessionId: session.id,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      locale: user.locale,
      mustChangePassword: user.mustChangePassword,
      isPlatformAdmin: user.isPlatformAdmin,
      mfaEnabled: user.mfaEnabled,
    },
    organizationId: user.organizationId ?? "",
    permissions,
    roleKeys: roles.map((r) => r.role.key),
    scope,
    propertyIds,
    tenantId: user.tenantId,
    vendorId: user.vendorId,
  };
});

/**
 * For pages: ensures a signed-in user holding the permission(s); redirects otherwise.
 * Every server page and action must call this (or `authorize`) before touching data.
 */
export async function requireContext(
  permission?: Permission | Permission[],
  opts: { allowPasswordChange?: boolean } = {},
): Promise<AuthContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (ctx.user.mustChangePassword && !opts.allowPasswordChange) redirect("/change-password");
  if (permission && !hasPermission(ctx.permissions, permission)) redirect("/unauthorized");
  return ctx;
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function authorize(permission?: Permission | Permission[]): Promise<AuthContext> {
  const ctx = await getContext();
  if (!ctx) throw new ForbiddenError("unauthenticated");
  if (ctx.user.mustChangePassword) throw new ForbiddenError("password_change_required");
  if (permission && !hasPermission(ctx.permissions, permission)) throw new ForbiddenError();
  return ctx;
}

export function can(ctx: AuthContext, permission: Permission | Permission[]) {
  return hasPermission(ctx.permissions, permission);
}

// ───────────── Record-level scoping helpers (organization + building) ─────────────

export function propertyWhere(ctx: AuthContext): Prisma.PropertyWhereInput {
  return {
    organizationId: ctx.organizationId,
    ...(ctx.propertyIds === "ALL" ? {} : { id: { in: ctx.propertyIds } }),
  };
}

export function byPropertyWhere(ctx: AuthContext): { organizationId: string; propertyId?: { in: string[] } } {
  return {
    organizationId: ctx.organizationId,
    ...(ctx.propertyIds === "ALL" ? {} : { propertyId: { in: ctx.propertyIds } }),
  };
}

export function unitWhere(ctx: AuthContext): Prisma.UnitWhereInput {
  return byPropertyWhere(ctx);
}

export function leaseWhere(ctx: AuthContext): Prisma.LeaseWhereInput {
  return {
    organizationId: ctx.organizationId,
    ...(ctx.propertyIds === "ALL" ? {} : { unit: { propertyId: { in: ctx.propertyIds } } }),
  };
}

export function tenantWhere(ctx: AuthContext): Prisma.TenantWhereInput {
  return {
    organizationId: ctx.organizationId,
    ...(ctx.propertyIds === "ALL"
      ? {}
      : { leases: { some: { unit: { propertyId: { in: ctx.propertyIds } } } } }),
  };
}

export function invoiceWhere(ctx: AuthContext): Prisma.InvoiceWhereInput {
  return {
    organizationId: ctx.organizationId,
    ...(ctx.propertyIds === "ALL"
      ? {}
      : { lease: { unit: { propertyId: { in: ctx.propertyIds } } } }),
  };
}

export function paymentWhere(ctx: AuthContext): Prisma.PaymentWhereInput {
  return {
    organizationId: ctx.organizationId,
    ...(ctx.propertyIds === "ALL"
      ? {}
      : { lease: { unit: { propertyId: { in: ctx.propertyIds } } } }),
  };
}

/** Work orders: technicians see assigned jobs, vendors see their company's jobs. */
export function maintenanceWhere(ctx: AuthContext): Prisma.MaintenanceRequestWhereInput {
  if (ctx.roleKeys.includes("vendor") && ctx.scope === "OWN") {
    return { organizationId: ctx.organizationId, vendorId: ctx.vendorId ?? "__none__" };
  }
  if (ctx.scope === "OWN") {
    return { organizationId: ctx.organizationId, assignedToId: ctx.user.id };
  }
  return byPropertyWhere(ctx);
}

export function assertPropertyAccess(ctx: AuthContext, propertyId: string) {
  if (ctx.propertyIds !== "ALL" && !ctx.propertyIds.includes(propertyId)) {
    throw new ForbiddenError("property_out_of_scope");
  }
}

/** Tenant-portal guard: returns the tenant ID bound to this user or redirects. */
export async function requireTenantPortal() {
  const ctx = await requireContext("portal.access");
  if (!ctx.tenantId) redirect("/unauthorized");
  return { ctx, tenantId: ctx.tenantId };
}
