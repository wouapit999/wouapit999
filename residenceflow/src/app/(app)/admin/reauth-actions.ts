"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/auth/context";
import { verifyPassword } from "@/lib/auth/password";
import { requestMeta } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { auditActor } from "@/services/admin";

const MAX_FAILURES = 5;
const WINDOW_MIN = 15;

/** Re-authentication for sensitive admin actions: verifies the password and stamps the session. */
export async function reauthAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize();
    const password = z.string().min(1).max(200).parse(fd.get("password"));
    const since = new Date(Date.now() - WINDOW_MIN * 60_000);
    const failures = await db.loginAttempt.count({ where: { userId: ctx.user.id, reason: "reauth_failed", createdAt: { gte: since } } });
    if (failures >= MAX_FAILURES) throw new BusinessError("auth.locked");
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { passwordHash: true, email: true } });
    const meta = await requestMeta();
    if (!(await verifyPassword(password, user.passwordHash))) {
      await db.loginAttempt.create({ data: { identifier: user.email, ip: meta.ip, userAgent: meta.userAgent, userId: ctx.user.id, success: false, reason: "reauth_failed" } });
      await audit(auditActor(ctx), { action: "auth.reauth", module: "auth", entityType: "User", entityId: ctx.user.id, result: "FAILURE" });
      throw new BusinessError("password.currentWrong");
    }
    await db.session.update({ where: { id: ctx.sessionId }, data: { reauthAt: new Date() } });
    await audit(auditActor(ctx), { action: "auth.reauth", module: "auth", entityType: "User", entityId: ctx.user.id });
    revalidatePath("/admin", "layout");
  }).then((r) => (r.ok ? { ...r, message: "adm.reauth.ok" } : r));
}
