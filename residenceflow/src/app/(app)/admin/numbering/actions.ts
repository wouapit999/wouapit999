"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/auth/context";
import { formToObject, runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { requireOrgId } from "@/services/admin";

const schema = z.object({
  id: z.string().uuid(),
  prefix: z.string().trim().max(12).regex(/^[A-Za-z0-9\-_/.]*$/, "Letters, digits and - _ / . only"),
  padding: z.coerce.number().int().min(1).max(10),
  nextValue: z.coerce.number().int().min(1).max(999_999_999),
});

/** Prefix/padding are editable; the counter may only move forward (never re-issue numbers). */
export async function updateSequenceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("settings.general.manage");
    const organizationId = requireOrgId(ctx);
    const d = schema.parse(formToObject(fd));
    await db.$transaction(async (tx) => {
      const seq = await tx.numberSequence.findFirst({ where: { id: d.id, organizationId } });
      if (!seq) throw new BusinessError("Sequence not found.");
      // Conditional update: guards against a concurrent allocation having moved the counter past nextValue.
      const r = await tx.numberSequence.updateMany({
        where: { id: seq.id, organizationId, nextValue: { lte: d.nextValue } },
        data: { prefix: d.prefix, padding: d.padding, nextValue: d.nextValue },
      });
      if (r.count !== 1) throw new BusinessError("The next number can only be increased.");
      await audit(ctx, {
        action: "settings.numbering_updated",
        module: "settings",
        entityType: "NumberSequence",
        entityId: seq.id,
        metadata: { key: seq.key },
        before: { prefix: seq.prefix, padding: seq.padding, nextValue: seq.nextValue },
        after: { prefix: d.prefix, padding: d.padding, nextValue: d.nextValue },
      }, tx);
    });
    revalidatePath("/admin/numbering");
  }).then((r) => (r.ok ? { ...r, message: "adm.saved" } : r));
}
