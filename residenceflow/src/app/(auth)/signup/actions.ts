"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { createSession, requestMeta } from "@/lib/auth/session";
import { safeEqual } from "@/lib/auth/crypto";
import { createEnterprise, selfSignupEnabled } from "@/services/enterprise";

const schema = z.object({
  orgName: z.string().trim().min(2).max(200),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(128),
  confirm: z.string().max(128),
  code: z.string().max(100).optional().default(""),
});

const MAX_PER_HOUR = 10;

/**
 * Public "create a new enterprise": one isolated organization + its administrator, then signs the
 * administrator in. Optional registration code (SIGNUP_CODE) and a per-IP limit protect it.
 */
export async function signupAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    if (!selfSignupEnabled()) throw new BusinessError("signup.disabled");
    const d = schema.parse(formToObject(fd));
    const required = process.env.SIGNUP_CODE;
    if (required && !safeEqual(d.code.trim(), required)) throw new BusinessError("signup.badCode");
    const meta = await requestMeta();
    const recent = await db.loginAttempt.count({ where: { ip: meta.ip, reason: "signup", createdAt: { gte: new Date(Date.now() - 3600_000) } } });
    if (recent >= MAX_PER_HOUR) throw new BusinessError("signup.rateLimited");
    await db.loginAttempt.create({ data: { identifier: d.adminEmail, ip: meta.ip, userAgent: meta.userAgent, success: true, reason: "signup" } });
    const { admin, org } = await createEnterprise(d, { firstRunOnly: false, source: "signup" });
    const settings = await db.organizationSettings.findUnique({ where: { organizationId: org.id }, select: { sessionTimeoutMinutes: true } });
    await createSession(admin.id, { timeoutMinutes: settings?.sessionTimeoutMinutes ?? 480 });
  });
  if (!r.ok) return r;
  redirect("/dashboard?welcome=1");
}
