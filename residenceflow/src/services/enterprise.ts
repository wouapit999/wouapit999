import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword, passwordPolicyErrors } from "@/lib/auth/password";
import { BusinessError } from "@/lib/errors";
import { createOrganization, ensurePlatformRole } from "./org";

export const ENTERPRISE_MIN_PASSWORD = 10;

export function slugify(name: string) {
  const s = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return s || "organization";
}

export interface NewEnterpriseInput {
  orgName: string;
  adminName: string;
  adminEmail: string;
  password: string;
  confirm: string;
}

/** Self-service enterprise creation is on unless ALLOW_SELF_SIGNUP=false. */
export function selfSignupEnabled() {
  return process.env.ALLOW_SELF_SIGNUP !== "false";
}

/**
 * Creates an isolated organization (its own settings, roles and numbering) and its first
 * ACTIVE administrator. Shared by the first-run setup page and the public "new enterprise"
 * sign-up. `firstRunOnly` keeps the setup page usable only while no organization exists.
 */
export async function createEnterprise(d: NewEnterpriseInput, opts: { firstRunOnly: boolean; source: "setup" | "signup" }) {
  if (d.password !== d.confirm) throw new BusinessError("password.mismatch");
  const errs = passwordPolicyErrors(d.password, ENTERPRISE_MIN_PASSWORD);
  if (errs.length) throw new BusinessError(errs[0]);
  const email = d.adminEmail.trim().toLowerCase();
  const hash = await hashPassword(d.password);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('gestpro:create-enterprise'))`;
    if (opts.firstRunOnly && (await tx.organization.count()) > 0) throw new BusinessError("setup.alreadyDone");
    if (await tx.user.findUnique({ where: { email }, select: { id: true } })) throw new BusinessError("setup.emailTaken");
    await ensurePlatformRole(tx);
    let slug = slugify(d.orgName);
    if (await tx.organization.findUnique({ where: { slug }, select: { id: true } })) slug = `${slug}-${Date.now().toString(36)}`;
    const org = await createOrganization(tx, { name: d.orgName.trim(), slug });
    const role = await tx.role.findFirstOrThrow({ where: { organizationId: org.id, key: "org_admin" } });
    const now = new Date();
    const admin = await tx.user.create({
      data: {
        organizationId: org.id,
        email,
        name: d.adminName.trim(),
        passwordHash: hash,
        passwordHistory: [hash],
        passwordChangedAt: now,
        status: "ACTIVE",
        roles: { create: { roleId: role.id } },
      },
    });
    await audit(null, {
      action: opts.source === "setup" ? "setup.completed" : "enterprise.created",
      module: "setup",
      entityType: "Organization",
      entityId: org.id,
      metadata: { adminUserId: admin.id, organization: org.name, source: opts.source },
    }, tx, org.id);
    return { org, admin };
  }, { timeout: 30_000 });
}
