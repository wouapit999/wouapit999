"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, leaseWhere, unitWhere, type AuthContext } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { getOrgSettings } from "@/lib/settings";
import { getT } from "@/i18n";
import { CONDITIONS, INSPECTION_TYPES, defaultChecklist, parseChecklist } from "./checklist";
import { inspectionMessages } from "./messages";
import { inspectionScope } from "./scope";

const optUuid = z.union([z.literal(""), z.string().uuid()]).optional().transform((v) => v || null);

const createSchema = z.object({
  unitId: z.string().uuid(),
  leaseId: optUuid,
  type: z.enum(INSPECTION_TYPES),
  scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
  inspectorName: z.string().trim().max(120).default(""),
});

export async function createInspectionAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    const ctx = await authorize("inspection.manage");
    const d = createSchema.parse(formToObject(fd));
    const unit = await db.unit.findFirst({ where: { ...unitWhere(ctx), id: d.unitId }, select: { id: true, propertyId: true, bedrooms: true, bathrooms: true } });
    if (!unit) throw new BusinessError("Unit not found.");
    if (d.leaseId) {
      const lease = await db.lease.findFirst({ where: { ...leaseWhere(ctx), id: d.leaseId }, select: { unitId: true } });
      if (!lease) throw new BusinessError("Lease not found.");
      if (lease.unitId !== unit.id) throw new BusinessError("The lease is for another unit.");
    }
    const settings = await getOrgSettings(ctx.organizationId);
    const scheduledFor = fromZonedTime(d.scheduledFor, settings?.timezone ?? "Africa/Douala");
    if (Number.isNaN(scheduledFor.getTime())) throw new BusinessError("Invalid date.");
    const items = defaultChecklist(unit.bedrooms, unit.bathrooms);
    const created = await db.$transaction(async (tx) => {
      const i = await tx.inspection.create({
        data: {
          organizationId: ctx.organizationId,
          unitId: unit.id,
          leaseId: d.leaseId,
          type: d.type,
          scheduledFor,
          inspectorName: d.inspectorName || ctx.user.name,
          items: items as unknown as Prisma.InputJsonValue,
          createdById: ctx.user.id,
        },
      });
      await audit(ctx, { action: "inspection.created", module: "inspections", entityType: "Inspection", entityId: i.id, propertyId: unit.propertyId, after: { ...d, scheduledFor } }, tx);
      return i;
    });
    id = created.id;
  });
  if (!r.ok) return r;
  revalidatePath("/inspections");
  redirect(`/inspections/${id}`);
}

const saveSchema = z.object({
  id: z.string().uuid(),
  meterReadings: z.string().trim().max(2000).default(""),
  keysHandedOver: z.string().trim().max(1000).default(""),
  notes: z.string().trim().max(4000).default(""),
  tenantAcknowledged: z.union([z.literal("on"), z.literal("")]).optional().transform((v) => v === "on"),
  inspectorName: z.string().trim().max(120).default(""),
  customRoom: z.string().trim().max(80).default(""),
  customItem: z.string().trim().max(80).default(""),
  intent: z.enum(["save", "complete"]).default("save"),
});
const condSchema = z.union([z.literal(""), z.enum(CONDITIONS)]);

async function loadInspection(ctx: AuthContext, id: string) {
  const insp = await db.inspection.findFirst({ where: { ...inspectionScope(ctx), id }, include: { unit: { select: { propertyId: true } } } });
  if (!insp) throw new BusinessError("Inspection not found.");
  return insp;
}

export async function saveInspectionAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("inspection.manage");
    const d = saveSchema.parse(formToObject(fd));
    const insp = await loadInspection(ctx, d.id);
    if (insp.status !== "SCHEDULED") throw new BusinessError("This inspection is locked.");
    // Room/item labels come from the stored checklist, never from the client.
    const rows = parseChecklist(insp.items).map((row, i) => ({
      ...row,
      condition: condSchema.parse(String(fd.get(`cond_${i}`) ?? "")),
      notes: z.string().trim().max(500).parse(String(fd.get(`notes_${i}`) ?? "")),
    }));
    if (d.customRoom && d.customItem) rows.push({ room: d.customRoom, item: d.customItem, condition: "", notes: "" });
    const complete = d.intent === "complete";
    if (complete && rows.some((r) => !r.condition)) throw new BusinessError("Rate every checklist line before completing the inspection.");
    const data = {
      items: rows as unknown as Prisma.InputJsonValue,
      meterReadings: d.meterReadings,
      keysHandedOver: d.keysHandedOver,
      notes: d.notes,
      tenantAcknowledged: d.tenantAcknowledged,
      ...(d.inspectorName ? { inspectorName: d.inspectorName } : {}),
      ...(complete ? { status: "COMPLETED", completedAt: new Date() } : {}),
    };
    await db.$transaction(async (tx) => {
      await tx.inspection.update({ where: { id: insp.id }, data });
      await audit(
        ctx,
        {
          action: complete ? "inspection.completed" : "inspection.updated",
          module: "inspections",
          entityType: "Inspection",
          entityId: insp.id,
          propertyId: insp.unit.propertyId,
          before: { status: insp.status, tenantAcknowledged: insp.tenantAcknowledged },
          after: { status: complete ? "COMPLETED" : insp.status, tenantAcknowledged: d.tenantAcknowledged, rows: rows.length },
        },
        tx,
      );
    });
    revalidatePath(`/inspections/${insp.id}`);
    return complete;
  });
  if (!r.ok) return r;
  const { t } = await getT(inspectionMessages);
  return { ok: true, message: r.data ? t("insp.completed") : t("insp.saved") };
}

export async function cancelInspectionAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("inspection.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    const insp = await loadInspection(ctx, id);
    if (insp.status !== "SCHEDULED") throw new BusinessError("Only scheduled inspections can be cancelled.");
    await db.$transaction(async (tx) => {
      await tx.inspection.update({ where: { id }, data: { status: "CANCELLED" } });
      await audit(ctx, { action: "inspection.cancelled", module: "inspections", entityType: "Inspection", entityId: id, propertyId: insp.unit.propertyId, before: { status: insp.status }, after: { status: "CANCELLED" } }, tx);
    });
    revalidatePath(`/inspections/${id}`);
  });
  if (!r.ok) return r;
  return { ok: true, message: (await getT(inspectionMessages)).t("insp.cancelled") };
}
