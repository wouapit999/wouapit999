import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { unitWhere, type AuthContext } from "@/lib/auth/context";
import { getOrgSettings } from "@/lib/settings";
import { unitLabel } from "../leases/data";
import { CHECKLIST_ITEMS } from "./messages";

export type ChecklistEntry = { item: string; received: boolean };

/** Applications module is on unless the organization explicitly turned the flag off. */
export async function applicationsEnabled(organizationId: string) {
  const s = await getOrgSettings(organizationId);
  const flags = s?.featureFlags && typeof s.featureFlags === "object" && !Array.isArray(s.featureFlags) ? (s.featureFlags as Record<string, unknown>) : {};
  return flags.applications !== false;
}

/** Applications are scoped like units: building-scoped staff only see applications for their buildings (or with no unit). */
export function applicationWhere(ctx: AuthContext): Prisma.RentalApplicationWhereInput {
  return {
    organizationId: ctx.organizationId,
    ...(ctx.propertyIds === "ALL" ? {} : { OR: [{ unitId: null }, { unit: { propertyId: { in: ctx.propertyIds } } }] }),
  };
}

export async function loadScopedApplication(ctx: AuthContext, id: string) {
  return db.rentalApplication.findFirst({
    where: { AND: [applicationWhere(ctx), { id }] },
    include: { unit: { select: { id: true, number: true, block: true, status: true, propertyId: true, property: { select: { name: true } } } } },
  });
}

/** Units an applicant may be matched to: vacant/reserved, in scope, not archived. */
export async function availableUnits(ctx: AuthContext, includeId?: string | null) {
  const rows = await db.unit.findMany({
    where: {
      AND: [
        unitWhere(ctx),
        { archived: false },
        { OR: [{ status: { in: ["VACANT", "RESERVED"] } }, ...(includeId ? [{ id: includeId }] : [])] },
      ],
    },
    orderBy: [{ property: { name: "asc" } }, { number: "asc" }],
    take: 1000,
    select: { id: true, number: true, block: true, status: true, property: { select: { name: true } } },
  });
  return rows.map((u) => ({ id: u.id, status: u.status, label: unitLabel(u) }));
}

export function parseChecklist(raw: unknown): ChecklistEntry[] {
  const known = new Map<string, boolean>(CHECKLIST_ITEMS.map((i) => [i, false]));
  if (Array.isArray(raw)) {
    for (const e of raw) {
      if (e && typeof e === "object" && typeof (e as { item?: unknown }).item === "string") {
        known.set((e as { item: string }).item, (e as { received?: unknown }).received === true);
      }
    }
  }
  return [...known.entries()].map(([item, received]) => ({ item, received }));
}
