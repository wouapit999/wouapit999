"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { type ActionResult, runAction, BusinessError } from "@/lib/action";
import { hashToken } from "./crypto";
import { hashPassword, isReusedPassword, passwordPolicyErrors, verifyPassword } from "./password";
import { createSession, destroyCurrentSession, readSession, requestMeta, revokeAllSessions } from "./session";
import { getContext, requireContext } from "./context";
import { sendEmail } from "@/lib/notify/email";
import { issueResetToken } from "./tokens";
import { verifyTotp } from "@/domain/totp";
import { LOCALE_COOKIE } from "@/i18n";

const DEFAULT_SECURITY = { maxLoginAttempts: 5, lockoutMinutes: 15, sessionTimeoutMinutes: 480, passwordMinLength: 10, passwordHistoryCount: 3 };
const IP_WINDOW_MIN = 15;
const IP_MAX_FAILURES = 30;

async function securitySettings(organizationId: string | null | undefined) {
  if (!organizationId) return DEFAULT_SECURITY;
  const s = await db.organizationSettings.findUnique({ where: { organizationId } });
  return s ?? DEFAULT_SECURITY;
}

function landingFor(roleKeys: string[], permissions: string[]) {
  if (permissions.includes("platform.organizations.manage")) return "/platform";
  if (permissions.includes("portal.access") && !permissions.includes("dashboard.view")) return "/portal/home";
  return "/dashboard";
}

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
});

export async function loginAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({ identifier: fd.get("identifier"), password: fd.get("password") });
  if (!parsed.success) return { ok: false, error: "auth.invalid" };
  const identifier = parsed.data.identifier.toLowerCase();
  const meta = await requestMeta();
  const windowStart = new Date(Date.now() - IP_WINDOW_MIN * 60_000);

  // IP-level brute-force protection (independent of the account).
  const ipFailures = await db.loginAttempt.count({ where: { ip: meta.ip, success: false, createdAt: { gte: windowStart } } });
  if (ipFailures >= IP_MAX_FAILURES) {
    await db.loginAttempt.create({ data: { identifier, ip: meta.ip, userAgent: meta.userAgent, success: false, reason: "ip_rate_limited" } });
    return { ok: false, error: "auth.locked" };
  }

  const user = await db.user.findFirst({
    where: { OR: [{ email: identifier }, { username: identifier }] },
    include: { roles: { include: { role: true } } },
  });
  const sec = await securitySettings(user?.organizationId);

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    await db.loginAttempt.create({ data: { identifier, ip: meta.ip, userAgent: meta.userAgent, userId: user.id, success: false, reason: "locked" } });
    return { ok: false, error: "auth.locked" };
  }

  const passwordOk = await verifyPassword(parsed.data.password, user?.passwordHash);
  const orgActive = user?.organizationId
    ? (await db.organization.findUnique({ where: { id: user.organizationId } }))?.status === "ACTIVE"
    : true;

  if (!user || !passwordOk || user.status !== "ACTIVE" || !orgActive) {
    const reason = !user ? "unknown_user" : !passwordOk ? "bad_password" : "inactive";
    await db.loginAttempt.create({ data: { identifier, ip: meta.ip, userAgent: meta.userAgent, userId: user?.id, success: false, reason } });
    if (user && !passwordOk) {
      const failed = user.failedLoginCount + 1;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed,
          lockedUntil: failed >= sec.maxLoginAttempts ? new Date(Date.now() + sec.lockoutMinutes * 60_000) : undefined,
        },
      });
    }
    if (user) {
      await audit(null, { action: "auth.login", module: "auth", entityType: "User", entityId: user.id, result: "FAILURE", metadata: { reason } }, db, user.organizationId);
    }
    return { ok: false, error: "auth.invalid" };
  }

  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await db.loginAttempt.create({ data: { identifier, ip: meta.ip, userAgent: meta.userAgent, userId: user.id, success: true } });
  await createSession(user.id, { timeoutMinutes: sec.sessionTimeoutMinutes, mfaPending: user.mfaEnabled });
  await audit({ organizationId: user.organizationId ?? "", user: { id: user.id, name: user.name } } as never, {
    action: "auth.login", module: "auth", entityType: "User", entityId: user.id, metadata: { mfa: user.mfaEnabled },
  }, db, user.organizationId);

  if (user.locale) (await cookies()).set(LOCALE_COOKIE, user.locale, { path: "/", sameSite: "lax", maxAge: 31536000 });
  if (user.mfaEnabled) redirect("/mfa/verify");
  if (user.mustChangePassword) redirect("/change-password");
  const perms = user.roles.flatMap((r) => r.role.permissions);
  redirect(landingFor(user.roles.map((r) => r.role.key), perms));
}

export async function mfaVerifyAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await readSession();
  if (!session || !session.mfaPending) redirect("/login");
  const code = String(fd.get("code") ?? "").trim();
  const user = session.user;
  let ok = false;
  let usedRecovery = false;
  if (user.mfaSecret && /^\d{6}$/.test(code.replace(/\s/g, ""))) ok = verifyTotp(user.mfaSecret, code);
  if (!ok && code.length >= 8) {
    const h = hashToken(code.toUpperCase());
    if (user.mfaRecoveryCodes.includes(h)) {
      ok = true;
      usedRecovery = true;
      await db.user.update({ where: { id: user.id }, data: { mfaRecoveryCodes: user.mfaRecoveryCodes.filter((c) => c !== h) } });
    }
  }
  const meta = await requestMeta();
  if (!ok) {
    await db.loginAttempt.create({ data: { identifier: user.email, ip: meta.ip, userId: user.id, success: false, reason: "mfa_failed" } });
    const recent = await db.loginAttempt.count({ where: { userId: user.id, reason: "mfa_failed", createdAt: { gte: new Date(Date.now() - 15 * 60_000) } } });
    if (recent >= 5) {
      await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      redirect("/login");
    }
    return { ok: false, error: "Invalid code." };
  }
  await db.session.update({ where: { id: session.id }, data: { mfaPending: false, reauthAt: new Date() } });
  await audit({ organizationId: user.organizationId ?? "", user: { id: user.id, name: user.name } } as never, {
    action: "auth.mfa_verified", module: "auth", entityType: "User", entityId: user.id, metadata: { usedRecovery },
  }, db, user.organizationId);
  if (user.mustChangePassword) redirect("/change-password");
  redirect("/dashboard");
}

export async function logoutAction() {
  const ctx = await getContext();
  await destroyCurrentSession();
  if (ctx) await audit(ctx, { action: "auth.logout", module: "auth", entityType: "User", entityId: ctx.user.id });
  redirect("/login");
}

const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) });

/** Always responds identically to avoid revealing whether an account exists. */
export async function forgotPasswordAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = forgotSchema.safeParse({ email: fd.get("email") });
  if (parsed.success) {
    const meta = await requestMeta();
    const recent = await db.loginAttempt.count({ where: { ip: meta.ip, reason: "reset_request", createdAt: { gte: new Date(Date.now() - 15 * 60_000) } } });
    await db.loginAttempt.create({ data: { identifier: parsed.data.email, ip: meta.ip, success: true, reason: "reset_request" } });
    const user = recent < 10 ? await db.user.findUnique({ where: { email: parsed.data.email } }) : null;
    if (user && user.status === "ACTIVE") {
      const link = await issueResetToken(user.id, "RESET", 30);
      await sendEmail({ to: user.email, subject: "Password reset", text: `Use this link within 30 minutes to reset your password: ${link}\nIf you did not request this, ignore this email.` });
      await audit(null, { action: "auth.password_reset_requested", module: "auth", entityType: "User", entityId: user.id }, db, user.organizationId);
    }
  }
  return { ok: true, message: "auth.resetSent" };
}

const resetSchema = z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(128), confirm: z.string() });

export async function resetPasswordAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = resetSchema.safeParse({ token: fd.get("token"), password: fd.get("password"), confirm: fd.get("confirm") });
  if (!parsed.success) return { ok: false, error: "auth.tokenInvalid" };
  if (parsed.data.password !== parsed.data.confirm) return { ok: false, error: "password.mismatch" };
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(parsed.data.token) }, include: { user: true } });
  if (!record || record.usedAt || record.expiresAt < new Date()) return { ok: false, error: "auth.tokenInvalid" };
  const sec = await securitySettings(record.user.organizationId);
  const errs = passwordPolicyErrors(parsed.data.password, sec.passwordMinLength);
  if (errs.length) return { ok: false, error: errs[0] };
  if (await isReusedPassword(parsed.data.password, record.user.passwordHistory)) return { ok: false, error: "password.reused" };
  const hash = await hashPassword(parsed.data.password);
  await db.$transaction(async (tx) => {
    // Mark used first; the conditional update guarantees single use under concurrency.
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new BusinessError("auth.tokenInvalid");
    await tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: hash,
        passwordHistory: [hash, ...record.user.passwordHistory].slice(0, sec.passwordHistoryCount),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
        status: record.purpose === "ACTIVATION" && record.user.status === "INVITED" ? "ACTIVE" : record.user.status,
      },
    });
    await audit(null, {
      action: record.purpose === "ACTIVATION" ? "auth.account_activated" : "auth.password_reset_completed",
      module: "auth", entityType: "User", entityId: record.userId,
    }, tx, record.user.organizationId);
  });
  await revokeAllSessions(record.userId);
  redirect("/login?reset=1");
}

const changeSchema = z.object({ current: z.string().max(128), password: z.string().min(1).max(128), confirm: z.string() });

export async function changePasswordAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireContext(undefined, { allowPasswordChange: true });
    const data = changeSchema.parse({ current: fd.get("current"), password: fd.get("password"), confirm: fd.get("confirm") });
    if (data.password !== data.confirm) throw new BusinessError("password.mismatch");
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!(await verifyPassword(data.current, user.passwordHash))) throw new BusinessError("password.currentWrong");
    const sec = await securitySettings(user.organizationId);
    const errs = passwordPolicyErrors(data.password, sec.passwordMinLength);
    if (errs.length) throw new BusinessError(errs[0]);
    if (await isReusedPassword(data.password, [user.passwordHash ?? "", ...user.passwordHistory].filter(Boolean))) throw new BusinessError("password.reused");
    const hash = await hashPassword(data.password);
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hash,
        passwordHistory: [hash, ...user.passwordHistory].slice(0, sec.passwordHistoryCount),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });
    await revokeAllSessions(user.id, ctx.sessionId);
    await audit(ctx, { action: "auth.password_changed", module: "auth", entityType: "User", entityId: user.id });
    const wasForced = user.mustChangePassword;
    if (wasForced) redirect("/dashboard");
    return undefined;
  }).then((r) => (r.ok ? { ok: true, message: "Password updated." } : r));
}

export async function setLocaleAction(fd: FormData) {
  const locale = fd.get("locale") === "en" ? "en" : "fr";
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 31536000 });
  const ctx = await getContext();
  if (ctx) await db.user.update({ where: { id: ctx.user.id }, data: { locale } });
}

export async function setThemeAction(fd: FormData) {
  const theme = fd.get("theme") === "dark" ? "dark" : "light";
  (await cookies()).set("rf_theme", theme, { path: "/", sameSite: "lax", maxAge: 31536000 });
}
