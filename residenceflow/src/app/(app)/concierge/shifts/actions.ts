"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { getT } from "@/i18n";
import { endShift, issueKey, returnKey, startShift } from "@/services/concierge";
import { shiftMessages } from "./messages";

async function done(key: string): Promise<ActionResult> {
  return { ok: true, message: (await getT(shiftMessages)).t(key) };
}

export async function startShiftAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("concierge.shifts.manage");
    const d = z.object({ propertyId: z.string().uuid(), notes: z.string().trim().max(2000).default("") }).parse(formToObject(fd));
    await startShift(ctx, d);
    revalidatePath("/concierge/shifts");
  });
  return r.ok ? done("sh.startedOk") : r;
}

export async function endShiftAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("concierge.shifts.manage");
    const d = z.object({ id: z.string().uuid(), notes: z.string().trim().max(4000).default(""), handoverTo: z.string().trim().max(120).default("") }).parse(formToObject(fd));
    await endShift(ctx, d);
    revalidatePath("/concierge/shifts");
  });
  return r.ok ? done("sh.endedOk") : r;
}

export async function issueKeyAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("concierge.shifts.manage");
    const d = z
      .object({
        propertyId: z.string().uuid(),
        label: z.string().trim().min(1).max(120),
        holderName: z.string().trim().min(2).max(120),
        notes: z.string().trim().max(500).default(""),
      })
      .parse(formToObject(fd));
    await issueKey(ctx, d);
    revalidatePath("/concierge/shifts");
  });
  return r.ok ? done("sh.issuedOk") : r;
}

export async function returnKeyAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("concierge.shifts.manage");
    await returnKey(ctx, z.string().uuid().parse(fd.get("id")));
    revalidatePath("/concierge/shifts");
  });
  return r.ok ? done("sh.returnedOk") : r;
}
