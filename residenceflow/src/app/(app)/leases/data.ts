import "server-only";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { tenantScopeWhere } from "@/services/tenants";

export function unitLabel(u: { number: string; block: string; property: { name: string } }) {
  return `${u.property.name} · ${u.block ? `${u.block} · ` : ""}${u.number}`;
}

/** Tenants that may be put on a lease (in scope, not archived/blacklisted). */
export async function leasableTenants(ctx: AuthContext, includeId?: string) {
  const rows = await db.tenant.findMany({
    where: {
      AND: [
        tenantScopeWhere(ctx),
        { OR: [{ status: { notIn: ["ARCHIVED", "BLACKLISTED"] } }, ...(includeId ? [{ id: includeId }] : [])] },
      ],
    },
    orderBy: { legalName: "asc" },
    take: 1000,
    select: { id: true, legalName: true, reference: true },
  });
  return rows.map((r) => ({ id: r.id, label: `${r.legalName} (${r.reference})` }));
}
