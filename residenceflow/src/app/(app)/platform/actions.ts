"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/auth/context";
import { issueResetToken } from "@/lib/auth/tokens";
import { sendEmail } from "@/lib/notify/email";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { createOrganization } from "@/services/org";

const createSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/, "Lowercase letters, digits and hyphens"),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email().max(200),
});

/** Creates an organization with its default roles/settings and invites its first administrator. */
export async function createOrganizationAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("platform.organizations.manage");
    const d = createSchema.parse(formToObject(fd));
    if (await db.organization.findUnique({ where: { slug: d.slug }, select: { id: true } })) throw new BusinessError("plat.slugTaken");
    if (await db.user.findUnique({ where: { email: d.adminEmail }, select: { id: true } })) throw new BusinessError("plat.emailTaken");
    const { org, admin } = await db.$transaction(async (tx) => {
      const org = await createOrganization(tx, { name: d.name, slug: d.slug });
      const role = await tx.role.findFirstOrThrow({ where: { organizationId: org.id, key: "org_admin" } });
      const admin = await tx.user.create({
        data: { organizationId: org.id, email: d.adminEmail, name: d.adminName, status: "INVITED", roles: { create: { roleId: role.id } } },
      });
      await audit(ctx, { action: "platform.organization_created", module: "platform", entityType: "Organization", entityId: org.id, after: { name: org.name, slug: org.slug } }, tx, org.id);
      await audit(ctx, { action: "user.invited", module: "users", entityType: "User", entityId: admin.id, after: { name: admin.name, email: admin.email, roles: ["org_admin"] } }, tx, org.id);
      return { org, admin };
    });
    const link = await issueResetToken(admin.id, "ACTIVATION", 72 * 60);
    let emailSent = false;
    try {
      emailSent = (await sendEmail({
        to: admin.email,
        subject: `Your ${org.name} administrator account`,
        text: `An administrator account was created for you for ${org.name}.\nChoose your password using this link (valid 72 h, single use):\n${link}\n\nUn compte administrateur a été créé pour vous pour ${org.name}. Choisissez votre mot de passe avec ce lien (valable 72 h, usage unique) :\n${link}`,
      })).sent;
    } catch {
      emailSent = false;
    }
    await audit(ctx, { action: "user.activation_link_issued", module: "users", entityType: "User", entityId: admin.id, metadata: { emailSent } }, db, org.id);
    revalidatePath("/platform");
    return { link, emailSent };
  }).then((r) => (r.ok ? { ...r, message: "plat.created" } : r));
}

const statusSchema = z.object({ id: z.string().uuid(), status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]) });

export async function setOrganizationStatusAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("platform.organizations.manage");
    const d = statusSchema.parse(formToObject(fd));
    const org = await db.organization.findUnique({ where: { id: d.id } });
    if (!org) throw new BusinessError("plat.notFound");
    if (org.status === d.status) return;
    await db.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: org.id }, data: { status: d.status } });
      if (d.status !== "ACTIVE") {
        // Sign everyone out immediately; login is refused while the organization is not active.
        await tx.session.updateMany({ where: { user: { organizationId: org.id }, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await audit(ctx, { action: `platform.organization_${d.status.toLowerCase()}`, module: "platform", entityType: "Organization", entityId: org.id, before: { status: org.status }, after: { status: d.status } }, tx, org.id);
    });
    revalidatePath("/platform");
  }).then((r) => (r.ok ? { ...r, message: "plat.saved" } : r));
}
