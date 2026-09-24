import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";

export const getOrgSettings = cache(async (organizationId: string) => {
  if (!organizationId) return null;
  return db.organizationSettings.findUnique({ where: { organizationId } });
});

/** Public branding for the login page: the first active organization (single-org deployments). */
export const getPublicBranding = cache(async () => {
  const org = await db.organization.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    include: { settings: true },
  });
  return org?.settings ?? null;
});
