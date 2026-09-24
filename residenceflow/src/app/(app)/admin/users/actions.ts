"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/auth/context";
import { issueResetToken } from "@/lib/auth/tokens";
import { revokeAllSessions } from "@/lib/auth/session";
import { sendEmail } from "@/lib/notify/email";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { getOrgSettings } from "@/lib/settings";
import {
  assertCanManageTarget,
  assertNotLastAdmin,
  createInvitedUser,
  findOrgUser,
  lockOrgAdmin,
  requireOrgId,
  validatePropertyIds,
  validateRoleAssignment,
} from "@/services/admin";
import { requireRecentReauth } from "@/services/reauth";
import { checkbox, stringList } from "../constants";

const ACTIVATION_MINUTES = 72 * 60;
const RESET_MINUTES = 60;
const id = z.string().uuid();

async function emailLink(organizationId: string, to: string, kind: "activation" | "reset", link: string, hours: number) {
  const s = await getOrgSettings(organizationId);
  const app = s?.appName ?? "ResidenceFlow";
  const fr = s?.defaultLanguage === "fr";
  const subject = kind === "activation"
    ? (fr ? `Activez votre compte ${app}` : `Activate your ${app} account`)
    : (fr ? `Réinitialisation du mot de passe ${app}` : `${app} password reset`);
  const text = kind === "activation"
    ? (fr
      ? `Un compte a été créé pour vous sur ${app}. Choisissez votre mot de passe avec ce lien (valable ${hours} h, usage unique) :\n${link}`
      : `An account was created for you on ${app}. Choose your password using this link (valid ${hours} h, single use):\n${link}`)
    : (fr
      ? `Un administrateur a demandé la réinitialisation de votre mot de passe ${app}. Lien valable ${hours} h, usage unique :\n${link}\nSi vous n'êtes pas concerné, contactez votre administrateur.`
      : `An administrator requested a password reset for your ${app} account. This link is valid for ${hours} h and can be used once:\n${link}\nIf this is unexpected, contact your administrator.`);
  try {
    const r = await sendEmail({ to, subject, text, fromName: s?.emailSenderName || undefined, replyTo: s?.replyToEmail || undefined });
    return r.sent;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "admin_email_failed", name: (e as Error)?.name }));
    return false;
  }
}

// ───────────── Invite / import ─────────────

const inviteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  username: z.union([z.literal(""), z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, "3–40 letters, digits, . _ -")]).default(""),
  phone: z.string().trim().max(40).default(""),
  locale: z.enum(["", "en", "fr"]).default(""),
  roleIds: stringList,
  propertyIds: stringList,
});

export async function inviteUserAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("users.manage");
    const d = inviteSchema.parse(formToObject(fd));
    if (d.roleIds.length === 0) throw new BusinessError("Select at least one role.");
    const user = await db.$transaction((tx) =>
      createInvitedUser(ctx, { name: d.name, email: d.email, username: d.username || null, phone: d.phone || null, locale: d.locale || null, roleIds: d.roleIds, propertyIds: d.propertyIds }, tx),
    );
    const link = await issueResetToken(user.id, "ACTIVATION", ACTIVATION_MINUTES);
    const emailSent = await emailLink(ctx.organizationId, user.email, "activation", link, 72);
    await audit(ctx, { action: "user.activation_link_issued", module: "users", entityType: "User", entityId: user.id, metadata: { emailSent } });
    revalidatePath("/admin/users");
    return { link, emailSent };
  }).then((r) => (r.ok ? { ...r, message: "adm.users.invited" } : r));
}

const MAX_IMPORT_ROWS = 200;

export async function bulkImportUsersAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("users.manage");
    const organizationId = requireOrgId(ctx);
    const csv = z.string().max(100_000).parse(fd.get("csv") ?? "");
    const lines = csv.split(/\r?\n/).map((l, i) => ({ line: i + 1, text: l.trim() })).filter((l) => l.text && !l.text.startsWith("#"));
    if (lines.length && /^name\s*[,;]\s*email/i.test(lines[0].text)) lines.shift();
    if (lines.length === 0) throw new BusinessError("The CSV is empty.");
    if (lines.length > MAX_IMPORT_ROWS) throw new BusinessError(`At most ${MAX_IMPORT_ROWS} rows per import.`);
    const roles = await db.role.findMany({ where: { organizationId, active: true, archived: false }, select: { id: true, key: true } });
    const rowSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(200), roleKey: z.string().trim().min(1).max(60) });
    const seen = new Set<string>();
    const rows: { line: number; ok: boolean; message: string; label?: string; link?: string }[] = [];
    for (const l of lines) {
      const cols = l.text.split(/[,;]/).map((c) => c.trim().replace(/^"|"$/g, ""));
      const parsed = rowSchema.safeParse({ name: cols[0], email: cols[1], roleKey: cols[2] });
      if (cols.length !== 3 || !parsed.success) {
        rows.push({ line: l.line, ok: false, message: "adm.import.invalidRow" });
        continue;
      }
      const { name, email, roleKey } = parsed.data;
      if (seen.has(email)) {
        rows.push({ line: l.line, ok: false, label: email, message: "adm.import.duplicate" });
        continue;
      }
      seen.add(email);
      const role = roles.find((r) => r.key === roleKey);
      if (!role) {
        rows.push({ line: l.line, ok: false, label: `${email} (${roleKey})`, message: "adm.import.unknownRole" });
        continue;
      }
      try {
        const user = await db.$transaction((tx) => createInvitedUser(ctx, { name, email, roleIds: [role.id], propertyIds: [] }, tx));
        const link = await issueResetToken(user.id, "ACTIVATION", ACTIVATION_MINUTES);
        const emailSent = await emailLink(organizationId, user.email, "activation", link, 72);
        rows.push({ line: l.line, ok: true, label: email, message: emailSent ? "adm.import.createdEmailed" : "adm.import.created", link });
      } catch (e) {
        rows.push({ line: l.line, ok: false, label: email, message: e instanceof BusinessError ? e.message : "adm.import.failed" });
      }
    }
    const created = rows.filter((r) => r.ok).length;
    await audit(ctx, { action: "user.bulk_import", module: "users", metadata: { rows: rows.length, created, failed: rows.length - created } });
    revalidatePath("/admin/users");
    return { rows };
  }).then((r) => (r.ok ? { ...r, message: "adm.import.done" } : r));
}

// ───────────── Edit ─────────────

const profileSchema = z.object({
  id,
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).default(""),
  locale: z.enum(["", "en", "fr"]).default(""),
});

export async function updateUserProfileAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("users.manage");
    const d = profileSchema.parse(formToObject(fd));
    const user = await findOrgUser(ctx, d.id);
    assertCanManageTarget(ctx, user);
    const after = { name: d.name, phone: d.phone || null, locale: d.locale || null };
    await db.user.update({ where: { id: user.id }, data: after });
    await audit(ctx, { action: "user.updated", module: "users", entityType: "User", entityId: user.id, before: { name: user.name, phone: user.phone, locale: user.locale }, after });
    revalidatePath(`/admin/users/${user.id}`);
  }).then((r) => (r.ok ? { ...r, message: "adm.saved" } : r));
}

const accessSchema = z.object({ id, roleIds: stringList, propertyIds: stringList });

export async function updateUserAccessAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("users.manage");
    const d = accessSchema.parse(formToObject(fd));
    await db.$transaction(async (tx) => {
      await lockOrgAdmin(tx, ctx.organizationId);
      const user = await findOrgUser(ctx, d.id, tx);
      assertCanManageTarget(ctx, user);
      const currentRoleIds = user.roles.map((r) => r.roleId);
      const roleIds = await validateRoleAssignment(ctx, d.roleIds, currentRoleIds, tx);
      const propertyIds = await validatePropertyIds(ctx.organizationId, d.propertyIds, tx);
      await assertNotLastAdmin(ctx.organizationId, { userRoles: { userId: user.id, roleIds } }, tx);
      await tx.userRole.deleteMany({ where: { userId: user.id } });
      if (roleIds.length) await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: user.id, roleId })) });
      await tx.userPropertyScope.deleteMany({ where: { userId: user.id } });
      if (propertyIds.length) await tx.userPropertyScope.createMany({ data: propertyIds.map((propertyId) => ({ userId: user.id, propertyId })) });
      await audit(ctx, {
        action: "user.access_changed",
        module: "users",
        entityType: "User",
        entityId: user.id,
        before: { roles: user.roles.map((r) => r.role.key), propertyIds: user.propertyScopes.map((s) => s.propertyId) },
        after: { roleIds, propertyIds },
      }, tx);
    });
    revalidatePath(`/admin/users/${d.id}`);
  }).then((r) => (r.ok ? { ...r, message: "adm.saved" } : r));
}

const statusSchema = z.object({ id, status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]) });

export async function setUserStatusAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("users.manage");
    const d = statusSchema.parse(formToObject(fd));
    if (d.id === ctx.user.id && d.status !== "ACTIVE") throw new BusinessError("You cannot suspend or archive your own account.");
    const result = await db.$transaction(async (tx) => {
      await lockOrgAdmin(tx, ctx.organizationId);
      const user = await findOrgUser(ctx, d.id, tx);
      assertCanManageTarget(ctx, user);
      if (user.status === d.status) return user.status;
      let next: typeof user.status = d.status;
      if (d.status === "ACTIVE") {
        // Restoring an account that never set a password returns it to INVITED.
        next = user.passwordHash ? "ACTIVE" : "INVITED";
      } else {
        await assertNotLastAdmin(ctx.organizationId, { excludeUserIds: [user.id] }, tx);
      }
      await tx.user.update({ where: { id: user.id }, data: { status: next } });
      await audit(ctx, { action: `user.status_${next.toLowerCase()}`, module: "users", entityType: "User", entityId: user.id, before: { status: user.status }, after: { status: next } }, tx);
      return next;
    });
    if (result === "SUSPENDED" || result === "ARCHIVED") await revokeAllSessions(d.id);
    revalidatePath(`/admin/users/${d.id}`);
    revalidatePath("/admin/users");
  }).then((r) => (r.ok ? { ...r, message: "adm.saved" } : r));
}

export async function unlockUserAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("users.manage");
    const user = await findOrgUser(ctx, id.parse(fd.get("id")));
    assertCanManageTarget(ctx, user);
    await db.user.update({ where: { id: user.id }, data: { lockedUntil: null, failedLoginCount: 0 } });
    await audit(ctx, { action: "user.unlocked", module: "users", entityType: "User", entityId: user.id, before: { lockedUntil: user.lockedUntil, failedLoginCount: user.failedLoginCount } });
    revalidatePath(`/admin/users/${user.id}`);
  }).then((r) => (r.ok ? { ...r, message: "adm.users.unlocked" } : r));
}

// ───────────── Credentials ─────────────

const resetSchema = z.object({ id, forceChange: checkbox });

/** Issues a single-use reset (or activation) link. The admin never sets or sees a password. */
export async function sendResetLinkAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("users.password_reset");
    const d = resetSchema.parse(formToObject(fd));
    const user = await findOrgUser(ctx, d.id);
    assertCanManageTarget(ctx, user);
    if (user.status === "SUSPENDED" || user.status === "ARCHIVED") throw new BusinessError("Reactivate this account before sending a link.");
    const purpose = user.status === "INVITED" ? "ACTIVATION" : "RESET";
    const minutes = purpose === "ACTIVATION" ? ACTIVATION_MINUTES : RESET_MINUTES;
    if (d.forceChange && purpose === "RESET") await db.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
    const link = await issueResetToken(user.id, purpose, minutes);
    const emailSent = await emailLink(ctx.organizationId, user.email, purpose === "ACTIVATION" ? "activation" : "reset", link, minutes / 60);
    await audit(ctx, {
      action: purpose === "ACTIVATION" ? "user.activation_link_issued" : "user.password_reset_initiated",
      module: "users",
      entityType: "User",
      entityId: user.id,
      metadata: { emailSent, forceChange: d.forceChange && purpose === "RESET", expiresInMinutes: minutes },
    });
    revalidatePath(`/admin/users/${user.id}`);
    return { link, emailSent };
  }).then((r) => (r.ok ? { ...r, message: "adm.users.linkIssued" } : r));
}

export async function forcePasswordChangeAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("users.password_reset");
    const d = z.object({ id, value: checkbox }).parse(formToObject(fd));
    const user = await findOrgUser(ctx, d.id);
    assertCanManageTarget(ctx, user);
    await db.user.update({ where: { id: user.id }, data: { mustChangePassword: d.value } });
    await audit(ctx, { action: "user.force_password_change", module: "users", entityType: "User", entityId: user.id, before: { mustChange: user.mustChangePassword }, after: { mustChange: d.value } });
    revalidatePath(`/admin/users/${user.id}`);
  }).then((r) => (r.ok ? { ...r, message: "adm.saved" } : r));
}

export async function resetMfaAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("users.mfa_reset");
    await requireRecentReauth(ctx);
    const user = await findOrgUser(ctx, id.parse(fd.get("id")));
    assertCanManageTarget(ctx, user);
    await db.user.update({ where: { id: user.id }, data: { mfaSecret: null, mfaEnabled: false, mfaRecoveryCodes: [] } });
    await revokeAllSessions(user.id, user.id === ctx.user.id ? ctx.sessionId : undefined);
    await audit(ctx, { action: "user.mfa_reset", module: "users", entityType: "User", entityId: user.id, metadata: { wasEnabled: user.mfaEnabled } });
    revalidatePath(`/admin/users/${user.id}`);
  }).then((r) => (r.ok ? { ...r, message: "adm.users.mfaReset" } : r));
}

// ───────────── Sessions ─────────────

export async function revokeUserSessionAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("users.manage");
    const d = z.object({ id, sessionId: id }).parse(formToObject(fd));
    const user = await findOrgUser(ctx, d.id);
    assertCanManageTarget(ctx, user);
    const r = await db.session.updateMany({ where: { id: d.sessionId, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count !== 1) throw new BusinessError("Session not found.");
    await audit(ctx, { action: "user.session_revoked", module: "users", entityType: "User", entityId: user.id, metadata: { sessionId: d.sessionId } });
    revalidatePath(`/admin/users/${user.id}`);
  }).then((r) => (r.ok ? { ...r, message: "adm.sessions.revoked" } : r));
}

export async function revokeAllUserSessionsAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("users.manage");
    const user = await findOrgUser(ctx, id.parse(fd.get("id")));
    assertCanManageTarget(ctx, user);
    await revokeAllSessions(user.id, user.id === ctx.user.id ? ctx.sessionId : undefined);
    await audit(ctx, { action: "user.sessions_revoked_all", module: "users", entityType: "User", entityId: user.id });
    revalidatePath(`/admin/users/${user.id}`);
  }).then((r) => (r.ok ? { ...r, message: "adm.sessions.revoked" } : r));
}
