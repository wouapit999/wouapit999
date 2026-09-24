"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, tenantWhere } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { getT } from "@/i18n";
import { COLLECTION_NOTE_KINDS, addCollectionNote, parseDay } from "@/services/finance-extra";
import { financeMessages, translateResult } from "../invoices/messages";
import { arrearsMessages } from "./messages";

const noteSchema = z.object({
  tenantId: z.string().uuid(),
  kind: z.enum(COLLECTION_NOTE_KINDS),
  note: z.string().trim().min(2).max(2000),
  promisedAmount: z.union([z.literal(""), z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/)]),
  promisedDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  escalation: z.string().trim().max(120),
});

export async function addCollectionNoteAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("arrears.manage");
    const s = (k: string) => String(fd.get(k) ?? "");
    const data = noteSchema.parse({
      tenantId: s("tenantId"),
      kind: s("kind"),
      note: s("note"),
      promisedAmount: s("promisedAmount").trim(),
      promisedDate: s("promisedDate"),
      escalation: s("escalation"),
    });
    const tenant = await db.tenant.findFirst({ where: { AND: [tenantWhere(ctx), { id: data.tenantId }] }, select: { id: true } });
    if (!tenant) throw new BusinessError("Tenant not found.");
    await addCollectionNote(ctx, {
      tenantId: tenant.id,
      kind: data.kind,
      note: data.note,
      promisedAmount: data.promisedAmount || null,
      promisedDate: parseDay(data.promisedDate),
      escalation: data.escalation || null,
    });
    revalidatePath(`/arrears/${tenant.id}`);
    revalidatePath("/arrears");
  });
  const { t } = await getT(financeMessages, arrearsMessages);
  return translateResult(r.ok ? { ...r, message: "arr.noteAdded" } : r, t);
}
