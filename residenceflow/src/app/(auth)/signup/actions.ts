"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { createSession, requestMeta } from "@/lib/auth/session";
import { getLocale } from "@/i18n";
import { createEnterprise, selfSignupEnabled } from "@/services/enterprise";
import {
  approveRequest, CODE_TTL_MINUTES, findByApprovalToken, findVerified, rejectRequest, requestAccess, SIGNUP_COOKIE, verifyCode,
} from "@/services/signup-requests";

const requestSchema = z.object({
  orgName: z.string().trim().min(2).max(200),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email().max(200),
});

/** Step 1: record the request and notify the operator. */
export async function requestAccessAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let notified = true;
  const r = await runAction(async () => {
    if (!selfSignupEnabled()) throw new BusinessError("signup.disabled");
    const d = requestSchema.parse(formToObject(fd));
    const meta = await requestMeta();
    const res = await requestAccess({ email: d.adminEmail, name: d.adminName, orgName: d.orgName, locale: await getLocale(), ip: meta.ip });
    notified = res.operatorNotified;
  });
  if (!r.ok) return r;
  redirect(`/signup/requested${notified ? "" : "?mail=0"}`);
}

const verifySchema = z.object({ email: z.string().trim().toLowerCase().email().max(200), code: z.string().trim().min(4).max(20) });

/** Step 3: check the code, then hand the applicant a verification cookie that dies with the code. */
export async function verifyCodeAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    if (!selfSignupEnabled()) throw new BusinessError("signup.disabled");
    const d = verifySchema.parse(formToObject(fd));
    const meta = await requestMeta();
    const recent = await db.loginAttempt.count({ where: { ip: meta.ip, reason: "signup_code", createdAt: { gte: new Date(Date.now() - 15 * 60_000) } } });
    if (recent >= 20) throw new BusinessError("signup.rateLimited");
    await db.loginAttempt.create({ data: { identifier: d.email, ip: meta.ip, userAgent: meta.userAgent, success: false, reason: "signup_code" } });
    const { verifyToken, request } = await verifyCode(d.email, d.code);
    (await cookies()).set(SIGNUP_COOKIE, verifyToken, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/signup",
      expires: request.codeExpiresAt ?? new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    });
  });
  if (!r.ok) return r;
  redirect("/signup/complete");
}

const completeSchema = z.object({
  orgName: z.string().trim().min(2).max(200),
  adminName: z.string().trim().min(2).max(120),
  password: z.string().min(1).max(128),
  confirm: z.string().max(128),
});

/** Step 4: create the enterprise for the verified applicant and sign them in. */
export async function completeSignupAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    if (!selfSignupEnabled()) throw new BusinessError("signup.disabled");
    const jar = await cookies();
    const req = await findVerified(jar.get(SIGNUP_COOKIE)?.value);
    if (!req) throw new BusinessError("signup.sessionExpired");
    const d = completeSchema.parse(formToObject(fd));
    const { admin, org } = await createEnterprise(
      { orgName: d.orgName, adminName: d.adminName, adminEmail: req.email, password: d.password, confirm: d.confirm },
      { firstRunOnly: false, source: "signup" },
    );
    await db.signupRequest.update({ where: { id: req.id }, data: { status: "USED", usedAt: new Date(), organizationId: org.id, verifyTokenHash: null } });
    jar.delete(SIGNUP_COOKIE);
    const settings = await db.organizationSettings.findUnique({ where: { organizationId: org.id }, select: { sessionTimeoutMinutes: true } });
    await createSession(admin.id, { timeoutMinutes: settings?.sessionTimeoutMinutes ?? 480 });
  });
  if (!r.ok) return r;
  redirect("/dashboard?welcome=1");
}

/** Operator decision from the emailed link (the link token is the credential). */
export async function decideByTokenAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const token = z.string().min(20).max(200).parse(fd.get("token"));
    const decision = z.enum(["approve", "reject"]).parse(fd.get("decision"));
    const req = await findByApprovalToken(token);
    if (!req) throw new BusinessError("signup.notFound");
    if (decision === "reject") {
      await rejectRequest(req.id, "email-link");
      return { rejected: true as const };
    }
    const res = await approveRequest(req.id, "email-link");
    return { approved: true as const, code: res.code, expiresAt: res.expiresAt.toISOString(), emailed: res.emailed, email: res.email };
  });
}
