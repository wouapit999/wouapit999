"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword, passwordPolicyErrors } from "@/lib/auth/password";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { createOrganization, ensurePlatformRole } from "@/services/org";

const SETUP_MIN_PASSWORD = 10;

const schema = z.object({
  orgName: z.string().trim().min(2).max(200),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(128),
  confirm: z.string().max(128),
});

function slugify(name: string) {
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

/**
 * First-run setup: creates the first organization and its ACTIVE administrator. Only possible while
 * no organization exists; the count is re-checked under a transaction-scoped advisory lock so two
 * concurrent submissions cannot both succeed.
 */
export async function setupAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    if ((await db.organization.count()) > 0) throw new BusinessError("setup.alreadyDone");
    const d = schema.parse(formToObject(fd));
    if (d.password !== d.confirm) throw new BusinessError("password.mismatch");
    const errs = passwordPolicyErrors(d.password, SETUP_MIN_PASSWORD);
    if (errs.length) throw new BusinessError(errs[0]);
    const hash = await hashPassword(d.password);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('residenceflow:first-run-setup'))`;
      if ((await tx.organization.count()) > 0) throw new BusinessError("setup.alreadyDone");
      if (await tx.user.findUnique({ where: { email: d.adminEmail }, select: { id: true } })) throw new BusinessError("setup.emailTaken");
      await ensurePlatformRole(tx);
      const org = await createOrganization(tx, { name: d.orgName, slug: slugify(d.orgName) });
      const role = await tx.role.findFirstOrThrow({ where: { organizationId: org.id, key: "org_admin" } });
      const now = new Date();
      const admin = await tx.user.create({
        data: {
          organizationId: org.id,
          email: d.adminEmail,
          name: d.adminName,
          passwordHash: hash,
          passwordHistory: [hash],
          passwordChangedAt: now,
          status: "ACTIVE",
          roles: { create: { roleId: role.id } },
        },
      });
      await audit(null, {
        action: "setup.completed",
        module: "setup",
        entityType: "Organization",
        entityId: org.id,
        metadata: { adminUserId: admin.id, organization: org.name },
      }, tx, org.id);
    }, { timeout: 30_000 });
  });
  if (!r.ok) return r;
  redirect("/login?setup=1");
}
