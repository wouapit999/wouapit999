"use server";

import { authorize } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { emailConfigured, sendEmail } from "@/lib/notify/email";
import { getOrgSettings } from "@/lib/settings";

/** Sends a test email to the signed-in administrator only (never to an arbitrary address). */
export async function sendTestEmailAction(_p: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  void _fd;
  return runAction(async () => {
    const ctx = await authorize("settings.notifications.manage");
    if (!emailConfigured()) throw new BusinessError("adm.notif.notConfigured");
    const s = await getOrgSettings(ctx.organizationId);
    let sent = false;
    try {
      const r = await sendEmail({
        to: ctx.user.email,
        subject: `${s?.appName ?? "ResidenceFlow"} — test email`,
        text: `This is a test email sent from ${s?.appName ?? "ResidenceFlow"} at ${new Date().toISOString()}.\nIf you received it, outgoing email is working.`,
        fromName: s?.emailSenderName || undefined,
        replyTo: s?.replyToEmail || undefined,
      });
      sent = r.sent;
    } catch (e) {
      await audit(ctx, { action: "notification.test_email", module: "settings", result: "FAILURE", metadata: { error: (e as Error)?.name } });
      throw new BusinessError("adm.notif.testFailed");
    }
    await audit(ctx, { action: "notification.test_email", module: "settings", result: sent ? "SUCCESS" : "FAILURE" });
    if (!sent) throw new BusinessError("adm.notif.testFailed");
  }).then((r) => (r.ok ? { ...r, message: "adm.notif.testSent" } : r));
}
