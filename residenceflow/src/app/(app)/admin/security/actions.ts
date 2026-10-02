"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/context";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { saveOrgSettings } from "@/services/admin";
import { requireRecentReauth } from "@/services/reauth";

const schema = z.object({
  sessionTimeoutMinutes: z.coerce.number().int().min(5).max(43_200),
  passwordMinLength: z.coerce.number().int().min(10).max(64),
  maxLoginAttempts: z.coerce.number().int().min(3).max(20),
  lockoutMinutes: z.coerce.number().int().min(1).max(1440),
  passwordHistoryCount: z.coerce.number().int().min(0).max(24),
});

export async function saveSecuritySettingsAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("settings.security.manage");
    await requireRecentReauth(ctx);
    const d = schema.parse(formToObject(fd));
    await saveOrgSettings(ctx, d, "settings.security_updated");
    revalidatePath("/admin/security");
  }).then((r) => (r.ok ? { ...r, message: "adm.saved" } : r));
}
