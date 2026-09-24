import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { invoiceWhere, tenantWhere, type AuthContext } from "@/lib/auth/context";
import { money, sum, type Decimal } from "@/lib/money";
import { invoiceBalance } from "@/services/billing";
import { OPEN_INVOICE_STATUSES } from "@/services/finance-extra";

/** Plans are scoped through their tenant: building-scoped staff only see plans of tenants with leases in their buildings. */
export function planWhere(ctx: AuthContext): Prisma.PaymentPlanWhereInput {
  return { organizationId: ctx.organizationId, tenant: tenantWhere(ctx) };
}

export async function loadScopedPlan(ctx: AuthContext, id: string) {
  return db.paymentPlan.findFirst({
    where: { AND: [planWhere(ctx), { id }] },
    include: {
      tenant: { select: { id: true, legalName: true, reference: true, phone: true, email: true } },
      installments: { orderBy: { sequence: "asc" } },
    },
  });
}

/** Tenants in scope with an outstanding balance (open invoices) and no ACTIVE plan. */
export async function tenantsEligibleForPlan(ctx: AuthContext, includeTenantId?: string | null) {
  const invoices = await db.invoice.findMany({
    where: { AND: [invoiceWhere(ctx), { status: { in: [...OPEN_INVOICE_STATUSES] } }] },
    select: { tenantId: true, total: true, amountPaid: true, amountCredited: true, tenant: { select: { legalName: true, reference: true } } },
  });
  const byTenant = new Map<string, { id: string; legalName: string; reference: string; outstanding: Decimal }>();
  for (const inv of invoices) {
    const e = byTenant.get(inv.tenantId) ?? { id: inv.tenantId, legalName: inv.tenant.legalName, reference: inv.tenant.reference, outstanding: money(0) };
    e.outstanding = sum([e.outstanding, invoiceBalance(inv)]);
    byTenant.set(inv.tenantId, e);
  }
  const ids = [...byTenant.keys()];
  const active = ids.length
    ? await db.paymentPlan.findMany({ where: { organizationId: ctx.organizationId, status: "ACTIVE", tenantId: { in: ids } }, select: { tenantId: true } })
    : [];
  const blocked = new Set(active.map((p) => p.tenantId));
  return [...byTenant.values()]
    .filter((x) => x.outstanding.gt(0) && (!blocked.has(x.id) || x.id === includeTenantId))
    .sort((a, b) => a.legalName.localeCompare(b.legalName));
}
