"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { getT } from "@/i18n";
import { collectParcel, logParcel } from "@/services/concierge";
import { parcelMessages } from "./messages";

const parcelSchema = z.object({
  propertyId: z.string().uuid(),
  unitId: z.union([z.literal(""), z.string().uuid()]).optional().transform((v) => v || null),
  recipientName: z.string().trim().min(2).max(120),
  carrier: z.string().trim().max(80).default(""),
  trackingNumber: z.string().trim().max(80).default(""),
  description: z.string().trim().max(300).default(""),
});

export async function logParcelAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("concierge.parcels.manage");
    await logParcel(ctx, parcelSchema.parse(formToObject(fd)));
    revalidatePath("/concierge/parcels");
  });
  return r.ok ? { ok: true, message: (await getT(parcelMessages)).t("par.logged") } : r;
}

export async function collectParcelAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("concierge.parcels.manage");
    const d = z.object({ id: z.string().uuid(), collectedBy: z.string().trim().min(2).max(120) }).parse(formToObject(fd));
    await collectParcel(ctx, d);
    revalidatePath("/concierge/parcels");
  });
  return r.ok ? { ok: true, message: (await getT(parcelMessages)).t("par.done") } : r;
}
