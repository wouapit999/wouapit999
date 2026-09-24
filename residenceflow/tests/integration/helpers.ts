import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createOrganization } from "@/services/org";
import type { AuthContext } from "@/lib/auth/context";
import { SYSTEM_ROLES } from "@/lib/permissions";

export function ctxFor(organizationId: string, userId: string, roleKey = "org_admin", propertyIds: "ALL" | string[] = "ALL"): AuthContext {
  const role = SYSTEM_ROLES.find((r) => r.key === roleKey)!;
  return {
    sessionId: "test",
    user: { id: userId, name: `User ${roleKey}`, email: `${userId}@t.test`, locale: "en", mustChangePassword: false, isPlatformAdmin: false, mfaEnabled: false },
    organizationId,
    permissions: new Set(role.permissions),
    roleKeys: [roleKey],
    scope: role.scope,
    propertyIds,
    tenantId: null,
    vendorId: null,
  };
}

/** Creates an isolated organization with one building, one unit, one tenant and a draft lease. */
export async function setupOrg(opts: { rent?: string; start?: Date; end?: Date } = {}) {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const org = await createOrganization(db, { name: `Test ${slug}`, slug });
  const admin = await db.user.create({ data: { email: `${slug}-admin@t.test`, name: "Admin", organizationId: org.id, status: "ACTIVE" } });
  const cashier = await db.user.create({ data: { email: `${slug}-cashier@t.test`, name: "Cashier", organizationId: org.id, status: "ACTIVE" } });
  const property = await db.property.create({ data: { organizationId: org.id, reference: "B1", name: "Building 1" } });
  const unit = await db.unit.create({ data: { organizationId: org.id, propertyId: property.id, number: "1A", defaultRent: "100000" } });
  const tenant = await db.tenant.create({ data: { organizationId: org.id, reference: "T1", legalName: "Tenant One" } });
  const lease = await db.lease.create({
    data: {
      organizationId: org.id, reference: "L1", unitId: unit.id, tenantId: tenant.id,
      startDate: opts.start ?? new Date(Date.UTC(2026, 0, 1)), endDate: opts.end ?? new Date(Date.UTC(2026, 11, 31)),
      rentAmount: opts.rent ?? "100000", dueDay: 5, depositAmount: "200000",
    },
  });
  return { org, admin, cashier, property, unit, tenant, lease, ctx: ctxFor(org.id, admin.id), cashierCtx: ctxFor(org.id, cashier.id, "cashier") };
}
