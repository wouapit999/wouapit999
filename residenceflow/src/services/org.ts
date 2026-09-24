import { db, type Tx } from "@/lib/db";
import { PLATFORM_ROLE, SYSTEM_ROLES } from "@/lib/permissions";
import { SEQUENCE_DEFAULTS } from "@/lib/numbering";

/** Creates or refreshes the default system roles for an organization. */
export async function ensureSystemRoles(organizationId: string, tx: Tx = db) {
  for (const r of SYSTEM_ROLES) {
    await tx.role.upsert({
      where: { organizationId_key: { organizationId, key: r.key } },
      create: { organizationId, key: r.key, name: r.name, description: r.description, scope: r.scope, permissions: r.permissions, isSystem: true },
      update: {},
    });
  }
}

export async function ensurePlatformRole(tx: Tx = db) {
  const existing = await tx.role.findFirst({ where: { organizationId: null, key: PLATFORM_ROLE.key } });
  if (existing) return existing;
  return tx.role.create({
    data: { key: PLATFORM_ROLE.key, name: PLATFORM_ROLE.name, description: PLATFORM_ROLE.description, scope: "PLATFORM", permissions: PLATFORM_ROLE.permissions, isSystem: true },
  });
}

export async function createOrganization(tx: Tx, input: { name: string; slug: string; appName?: string }) {
  const org = await tx.organization.create({ data: { name: input.name, slug: input.slug } });
  await tx.organizationSettings.create({
    data: { organizationId: org.id, companyName: input.name, appName: input.appName ?? "ResidenceFlow" },
  });
  await ensureSystemRoles(org.id, tx);
  for (const [key, def] of Object.entries(SEQUENCE_DEFAULTS)) {
    await tx.numberSequence.create({ data: { organizationId: org.id, key, prefix: def.prefix, padding: def.padding } });
  }
  return org;
}
