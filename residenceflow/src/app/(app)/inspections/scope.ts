import type { Prisma } from "@prisma/client";
import type { AuthContext } from "@/lib/auth/context";

/** Inspections are scoped through their unit's building. */
export function inspectionScope(ctx: AuthContext): Prisma.InspectionWhereInput {
  return { organizationId: ctx.organizationId, ...(ctx.propertyIds === "ALL" ? {} : { unit: { propertyId: { in: ctx.propertyIds } } }) };
}
