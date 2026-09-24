"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { authorize } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { getOrgSettings } from "@/lib/settings";
import { getT } from "@/i18n";
import { VISITOR_KINDS, checkInVisitor, checkOutVisitor, markArrived, preauthorizeVisitor } from "@/services/concierge";
import { visitorMessages } from "./messages";

const optUuid = z.union([z.literal(""), z.string().uuid()]).optional().transform((v) => v || null);
const visitorSchema = z.object({
  propertyId: z.string().uuid(),
  unitId: optUuid,
  hostTenantId: optUuid,
  visitorName: z.string().trim().min(2).max(120),
  visitorPhone: z.string().trim().max(40).default(""),
  kind: z.enum(VISITOR_KINDS),
  purpose: z.string().trim().max(300).default(""),
});

async function ok(key: string): Promise<ActionResult> {
  return { ok: true, message: (await getT(visitorMessages)).t(key) };
}

export async function checkInAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("concierge.visitors.manage");
    await checkInVisitor(ctx, visitorSchema.parse(formToObject(fd)));
    revalidatePath("/concierge/visitors");
  });
  return r.ok ? ok("vis.checkedIn") : r;
}

export async function preauthorizeAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("concierge.visitors.manage");
    const d = visitorSchema.extend({ expectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/) }).parse(formToObject(fd));
    const settings = await getOrgSettings(ctx.organizationId);
    const expectedAt = fromZonedTime(d.expectedAt, settings?.timezone ?? "Africa/Douala");
    if (Number.isNaN(expectedAt.getTime())) throw new BusinessError("Invalid date.");
    await preauthorizeVisitor(ctx, { ...d, expectedAt });
    revalidatePath("/concierge/visitors");
  });
  return r.ok ? ok("vis.registered") : r;
}

export async function arrivedAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("concierge.visitors.manage");
    await markArrived(ctx, z.string().uuid().parse(fd.get("id")));
    revalidatePath("/concierge/visitors");
  });
  return r.ok ? ok("vis.checkedIn") : r;
}

export async function checkOutAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("concierge.visitors.manage");
    await checkOutVisitor(ctx, z.string().uuid().parse(fd.get("id")));
    revalidatePath("/concierge/visitors");
  });
  return r.ok ? ok("vis.checkedOut") : r;
}
