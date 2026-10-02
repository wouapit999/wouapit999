import "server-only";
import type { Prisma } from "@prisma/client";
import { can, type AuthContext } from "@/lib/auth/context";

export const DOCUMENT_CATEGORIES = ["LEASE", "TENANT", "PROPERTY", "VENDOR", "INVOICE", "RECEIPT", "MAINTENANCE", "PAYMENT_PROOF", "OTHER"] as const;

/**
 * Server-side equivalent of canAccessDocument() for staff lists (so pagination and counts
 * are correct): organization + building scope (via property, lease or tenant link) +
 * sensitive documents only with document.sensitive.view. Own uploads are always visible.
 */
export function documentScopeWhere(ctx: AuthContext): Prisma.DocumentWhereInput {
  const sensitive: Prisma.DocumentWhereInput = can(ctx, "document.sensitive.view") ? {} : { sensitive: false };
  if (ctx.propertyIds === "ALL") {
    return { organizationId: ctx.organizationId, OR: [sensitive, { uploadedById: ctx.user.id }] };
  }
  const ids = ctx.propertyIds;
  return {
    organizationId: ctx.organizationId,
    OR: [
      { uploadedById: ctx.user.id },
      {
        AND: [
          sensitive,
          {
            OR: [
              { propertyId: { in: ids } },
              { propertyId: null, lease: { unit: { propertyId: { in: ids } } } },
              { propertyId: null, leaseId: null, tenant: { leases: { some: { unit: { propertyId: { in: ids } } } } } },
            ],
          },
        ],
      },
    ],
  };
}
