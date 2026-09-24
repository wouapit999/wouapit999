"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/auth/context";
import { issueResetToken } from "@/lib/auth/tokens";
import { verifyPassword } from "@/lib/auth/password";
import { requestMeta } from "@/lib/auth/session";
import { sendEmail } from "@/lib/notify/email";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { createOrganization } from "@/services/org";
import { auditActor } from "@/services/admin";
import { requireRecentReauth } from "@/services/reauth";
import { endSupportAccess, startSupportAccess, SUPPORT_DURATIONS } from "@/services/support-access";

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

// ───────────────────────────── Re-authentication ─────────────────────────────

const REAUTH_MAX_FAILURES = 5;
const REAUTH_WINDOW_MIN = 15;

/** Password confirmation for sensitive platform actions (same rules as the admin console). */
export async function platformReauthAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("platform.organizations.manage");
    const password = z.string().min(1).max(200).parse(fd.get("password"));
    const since = new Date(Date.now() - REAUTH_WINDOW_MIN * 60_000);
    const failures = await db.loginAttempt.count({ where: { userId: ctx.user.id, reason: "reauth_failed", createdAt: { gte: since } } });
    if (failures >= REAUTH_MAX_FAILURES) throw new BusinessError("auth.locked");
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { passwordHash: true, email: true } });
    const meta = await requestMeta();
    if (!(await verifyPassword(password, user.passwordHash))) {
      await db.loginAttempt.create({ data: { identifier: user.email, ip: meta.ip, userAgent: meta.userAgent, userId: ctx.user.id, success: false, reason: "reauth_failed" } });
      await audit(auditActor(ctx), { action: "auth.reauth", module: "auth", entityType: "User", entityId: ctx.user.id, result: "FAILURE" });
      throw new BusinessError("password.currentWrong");
    }
    await db.session.update({ where: { id: ctx.sessionId }, data: { reauthAt: new Date() } });
    await audit(auditActor(ctx), { action: "auth.reauth", module: "auth", entityType: "User", entityId: ctx.user.id });
    revalidatePath("/platform");
  }).then((r) => (r.ok ? { ...r, message: "sup.reauthOk" } : r));
}

// ───────────────────────────── Support access ─────────────────────────────

const startSupportSchema = z.object({
  organizationId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  reason: z.string().trim().min(10).max(1000),
  ticketRef: z.string().trim().max(100).default(""),
  durationMinutes: z.coerce.number().refine((n): n is (typeof SUPPORT_DURATIONS)[number] => (SUPPORT_DURATIONS as readonly number[]).includes(n)),
});

/** Opens a controlled support session as an organization administrator, then lands on that organization's dashboard. */
export async function startSupportAccessAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("platform.organizations.manage");
    const d = startSupportSchema.parse(formToObject(fd));
    await startSupportAccess(ctx, d);
  });
  if (!r.ok) return r;
  redirect("/dashboard");
}

const endSupportSchema = z.object({ id: z.string().uuid() });

/** Ends an active support-access grant from the platform console (revokes its session immediately). */
export async function endSupportAccessNowAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("platform.organizations.manage");
    const d = endSupportSchema.parse(formToObject(fd));
    await endSupportAccess(auditActor(ctx), d.id, "platform");
    revalidatePath("/platform");
  }).then((r) => (r.ok ? { ...r, message: "sup.ended" } : r));
}

// ───────────────────────────── Administrator reset ─────────────────────────────

const RESET_MINUTES = 30;
const ACTIVATION_MINUTES = 72 * 60;
const resetAdminSchema = z.object({ organizationId: z.string().uuid(), userId: z.string().uuid() });

/**
 * Issues a single-use password reset (or activation) link for an organization administrator.
 * The platform never sets or sees a password; the link is shown once and emailed when possible.
 */
export async function resetOrganizationAdminAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("platform.organizations.manage");
    await requireRecentReauth(ctx);
    const d = resetAdminSchema.parse(formToObject(fd));
    const user = await db.user.findFirst({
      where: { id: d.userId, organizationId: d.organizationId, status: { in: ["ACTIVE", "INVITED"] }, roles: { some: { role: { key: "org_admin" } } } },
      select: { id: true, email: true, name: true, status: true, organization: { select: { name: true } } },
    });
    if (!user) throw new BusinessError("sup.targetInvalid");
    const purpose = user.status === "INVITED" ? "ACTIVATION" : "RESET";
    const minutes = purpose === "ACTIVATION" ? ACTIVATION_MINUTES : RESET_MINUTES;
    const link = await issueResetToken(user.id, purpose, minutes);
    let emailSent = false;
    try {
      emailSent = (await sendEmail({
        to: user.email,
        subject: purpose === "ACTIVATION" ? `Your ${user.organization?.name ?? ""} administrator account` : "Password reset",
        text: `Use this single-use link within ${Math.round(minutes / 60)} h to ${purpose === "ACTIVATION" ? "activate your account" : "reset your password"}:\n${link}\n\nUtilisez ce lien à usage unique dans les ${Math.round(minutes / 60)} h pour ${purpose === "ACTIVATION" ? "activer votre compte" : "réinitialiser votre mot de passe"} :\n${link}`,
      })).sent;
    } catch {
      emailSent = false;
    }
    const entry = {
      action: purpose === "ACTIVATION" ? "user.activation_link_issued" : "platform.admin_password_reset_initiated",
      module: "platform",
      entityType: "User",
      entityId: user.id,
      metadata: { emailSent, expiresInMinutes: minutes, organizationId: d.organizationId },
    };
    await audit(ctx, entry, db, null);
    await audit(ctx, entry, db, d.organizationId);
    revalidatePath("/platform");
    return { link, emailSent };
  }).then((r) => (r.ok ? { ...r, message: "sup.resetIssued" } : r));
}
