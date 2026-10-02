"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, tenantWhere } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { getT } from "@/i18n";
import { NOTICE_LEVELS } from "@/domain/notice-templates";
import { addCollectionNote } from "@/services/finance-extra";
import { financeMessages, translateResult } from "../../../invoices/messages";
import { arrearsMessages } from "../../messages";

const schema = z.object({
  tenantId: z.string().uuid(),
  level: z.enum(NOTICE_LEVELS),
  language: z.enum(["en", "fr"]),
  body: z.string().trim().min(10).max(20_000),
});

/** Records that a notice was issued: an ESCALATION collection note plus an audit entry. */
export async function recordNoticeAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("arrears.manage");
    const s = (k: string) => String(fd.get(k) ?? "");
    const d = schema.parse({ tenantId: s("tenantId"), level: s("level"), language: s("language"), body: s("body") });
    const tenant = await db.tenant.findFirst({ where: { AND: [tenantWhere(ctx), { id: d.tenantId }] }, select: { id: true } });
    if (!tenant) throw new BusinessError("Tenant not found.");
    const note = await addCollectionNote(ctx, { tenantId: tenant.id, kind: "ESCALATION", escalation: d.level, note: d.body.slice(0, 500) });
    await audit(ctx, {
      action: "arrears.notice_issued",
      module: "arrears",
      entityType: "CollectionNote",
      entityId: note.id,
      metadata: { tenantId: tenant.id, level: d.level, language: d.language },
    });
    revalidatePath(`/arrears/${tenant.id}`);
    revalidatePath("/arrears");
  });
  const { t } = await getT(financeMessages, arrearsMessages);
  return translateResult(r.ok ? { ...r, message: "arr.noticeRecorded" } : r, t);
}
