"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireContext, type AuthContext } from "@/lib/auth/context";
import { verifyPassword } from "@/lib/auth/password";
import { hashToken } from "@/lib/auth/crypto";
import { requestMeta } from "@/lib/auth/session";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { getOrgSettings } from "@/lib/settings";
import { base32Encode, generateTotpSecret, otpauthUrl, verifyTotp } from "@/domain/totp";
import { LOCALE_COOKIE } from "@/i18n";
import { auditActor } from "@/services/admin";

const RECOVERY_CODES = 10;

/** Self-service actions: any signed-in user, always acting on their own account only. */
async function me() {
  return requireContext();
}

async function checkPassword(ctx: AuthContext, password: string) {
  const since = new Date(Date.now() - 15 * 60_000);
  const failures = await db.loginAttempt.count({ where: { userId: ctx.user.id, reason: "reauth_failed", createdAt: { gte: since } } });
  if (failures >= 5) throw new BusinessError("auth.locked");
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { passwordHash: true, email: true } });
  if (!(await verifyPassword(password, user.passwordHash))) {
    const meta = await requestMeta();
    await db.loginAttempt.create({ data: { identifier: user.email, ip: meta.ip, userAgent: meta.userAgent, userId: ctx.user.id, success: false, reason: "reauth_failed" } });
    throw new BusinessError("password.currentWrong");
  }
}

function newRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_CODES }, () => base32Encode(randomBytes(7)).slice(0, 10));
  return { codes, hashes: codes.map((c) => hashToken(c.toUpperCase())) };
}

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).default(""),
  locale: z.enum(["en", "fr"]),
});

export async function updateMyProfileAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await me();
    const d = profileSchema.parse(formToObject(fd));
    const before = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { name: true, phone: true, locale: true } });
    await db.user.update({ where: { id: ctx.user.id }, data: { name: d.name, phone: d.phone || null, locale: d.locale } });
    (await cookies()).set(LOCALE_COOKIE, d.locale, { path: "/", sameSite: "lax", maxAge: 31536000 });
    await audit(auditActor(ctx), { action: "account.profile_updated", module: "account", entityType: "User", entityId: ctx.user.id, before, after: { name: d.name, phone: d.phone || null, locale: d.locale } });
    revalidatePath("/", "layout");
  }).then((r) => (r.ok ? { ...r, message: "acct.saved" } : r));
}

/** Step 1: generate a secret (stored, but MFA stays disabled until a code is verified). */
export async function startMfaEnrollmentAction(_p: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  void _fd;
  return runAction(async () => {
    const ctx = await me();
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { mfaEnabled: true, email: true } });
    if (user.mfaEnabled) throw new BusinessError("acct.mfa.alreadyOn");
    const secret = generateTotpSecret();
    await db.user.update({ where: { id: ctx.user.id }, data: { mfaSecret: secret, mfaEnabled: false } });
    const s = ctx.organizationId ? await getOrgSettings(ctx.organizationId) : null;
    await audit(auditActor(ctx), { action: "account.mfa_enrollment_started", module: "account", entityType: "User", entityId: ctx.user.id });
    revalidatePath("/account");
    return { secret, uri: otpauthUrl(secret, user.email, s?.appName ?? "ResidenceFlow") };
  }).then((r) => (r.ok ? { ...r, message: "acct.mfa.scan" } : r));
}

/** Step 2: verify a code, enable MFA and show 10 recovery codes once (stored hashed). */
export async function verifyMfaEnrollmentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await me();
    const code = z.string().trim().regex(/^\d{6}$/, "6 digits").parse(String(fd.get("code") ?? "").replace(/\s/g, ""));
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { mfaSecret: true, mfaEnabled: true } });
    if (user.mfaEnabled) throw new BusinessError("acct.mfa.alreadyOn");
    if (!user.mfaSecret) throw new BusinessError("acct.mfa.startFirst");
    if (!verifyTotp(user.mfaSecret, code)) {
      await audit(auditActor(ctx), { action: "account.mfa_enabled", module: "account", entityType: "User", entityId: ctx.user.id, result: "FAILURE" });
      throw new BusinessError("acct.mfa.badCode");
    }
    const { codes, hashes } = newRecoveryCodes();
    await db.user.update({ where: { id: ctx.user.id }, data: { mfaEnabled: true, mfaRecoveryCodes: hashes } });
    await audit(auditActor(ctx), { action: "account.mfa_enabled", module: "account", entityType: "User", entityId: ctx.user.id });
    revalidatePath("/account");
    return { codes };
  }).then((r) => (r.ok ? { ...r, message: "acct.mfa.enabled" } : r));
}

export async function regenerateRecoveryCodesAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await me();
    await checkPassword(ctx, z.string().min(1).max(200).parse(fd.get("password")));
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { mfaEnabled: true } });
    if (!user.mfaEnabled) throw new BusinessError("acct.mfa.notOn");
    const { codes, hashes } = newRecoveryCodes();
    await db.user.update({ where: { id: ctx.user.id }, data: { mfaRecoveryCodes: hashes } });
    await audit(auditActor(ctx), { action: "account.mfa_recovery_regenerated", module: "account", entityType: "User", entityId: ctx.user.id });
    revalidatePath("/account");
    return { codes };
  }).then((r) => (r.ok ? { ...r, message: "acct.mfa.codesRegenerated" } : r));
}

export async function disableMfaAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await me();
    await checkPassword(ctx, z.string().min(1).max(200).parse(fd.get("password")));
    await db.user.update({ where: { id: ctx.user.id }, data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] } });
    await audit(auditActor(ctx), { action: "account.mfa_disabled", module: "account", entityType: "User", entityId: ctx.user.id });
    revalidatePath("/account");
  }).then((r) => (r.ok ? { ...r, message: "acct.mfa.disabled" } : r));
}

export async function revokeMySessionAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await me();
    const sessionId = z.string().uuid().parse(fd.get("sessionId"));
    if (sessionId === ctx.sessionId) throw new BusinessError("acct.sessions.current");
    const r = await db.session.updateMany({ where: { id: sessionId, userId: ctx.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count !== 1) throw new BusinessError("acct.sessions.notFound");
    await audit(auditActor(ctx), { action: "account.session_revoked", module: "account", entityType: "User", entityId: ctx.user.id, metadata: { sessionId } });
    revalidatePath("/account");
  }).then((r) => (r.ok ? { ...r, message: "acct.sessions.revoked" } : r));
}

export async function revokeMyOtherSessionsAction(_p: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  void _fd;
  return runAction(async () => {
    const ctx = await me();
    const r = await db.session.updateMany({ where: { userId: ctx.user.id, revokedAt: null, id: { not: ctx.sessionId } }, data: { revokedAt: new Date() } });
    await audit(auditActor(ctx), { action: "account.sessions_revoked_others", module: "account", entityType: "User", entityId: ctx.user.id, metadata: { count: r.count } });
    revalidatePath("/account");
  }).then((r) => (r.ok ? { ...r, message: "acct.sessions.revoked" } : r));
}
