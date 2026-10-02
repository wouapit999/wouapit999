"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, assertPropertyAccess, propertyWhere, unitWhere } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { toDb } from "@/lib/money";
import { getT } from "@/i18n";
import { FREQUENCIES, idField, moneyField, optMoneyField } from "../leases/fields";
import { FURNISHINGS, MANUAL_UNIT_STATUSES, UNIT_TYPES, unitMessages } from "./messages";

const unitSchema = z.object({
  block: z.string().trim().max(40).default(""),
  floor: z.coerce.number().int().min(-10).max(200).default(0),
  number: z.string().trim().min(1).max(40),
  type: z.enum(UNIT_TYPES),
  bedrooms: z.coerce.number().int().min(0).max(50).default(1),
  bathrooms: z.coerce.number().int().min(0).max(50).default(1),
  area: z.union([z.literal(""), z.string().trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "Invalid area")]).optional(),
  furnishing: z.enum(FURNISHINGS).default("UNFURNISHED"),
  defaultRent: moneyField,
  defaultDeposit: optMoneyField,
  defaultServiceCharge: optMoneyField,
  billingFrequency: z.enum(FREQUENCIES).default("MONTHLY"),
  meterIds: z.string().trim().max(200).default(""),
  notes: z.string().trim().max(4000).default(""),
});

function toData(d: z.infer<typeof unitSchema>) {
  return {
    block: d.block,
    floor: d.floor,
    number: d.number,
    type: d.type,
    bedrooms: d.bedrooms,
    bathrooms: d.bathrooms,
    area: d.area ? d.area : null,
    furnishing: d.furnishing,
    defaultRent: toDb(d.defaultRent),
    defaultDeposit: toDb(d.defaultDeposit),
    defaultServiceCharge: toDb(d.defaultServiceCharge),
    billingFrequency: d.billingFrequency,
    meterIds: d.meterIds,
    notes: d.notes,
  };
}

const ACTIVE_LEASE = ["ACTIVE", "NOTICE_GIVEN"] as const;
const BLOCKING_LEASE = ["ACTIVE", "NOTICE_GIVEN", "PENDING_APPROVAL"] as const;

export async function createUnitAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    const ctx = await authorize("unit.manage");
    const { t } = await getT(unitMessages);
    const raw = formToObject(fd);
    const propertyId = idField.parse(raw.propertyId);
    const data = toData(unitSchema.parse(raw));
    const property = await db.property.findFirst({ where: { ...propertyWhere(ctx), id: propertyId, status: { not: "ARCHIVED" } } });
    if (!property) throw new BusinessError(t("unit.err.buildingNotFound"));
    assertPropertyAccess(ctx, property.id);
    const dup = await db.unit.findFirst({ where: { propertyId: property.id, number: data.number }, select: { id: true } });
    if (dup) throw new BusinessError(t("unit.err.duplicate"));
    const created = await db.$transaction(async (tx) => {
      const u = await tx.unit.create({ data: { ...data, organizationId: ctx.organizationId, propertyId: property.id } });
      await tx.unitStatusHistory.create({ data: { unitId: u.id, from: null, to: u.status, reason: "Created", actorId: ctx.user.id } });
      await audit(ctx, { action: "unit.created", module: "units", entityType: "Unit", entityId: u.id, propertyId: property.id, after: data }, tx);
      return u;
    });
    id = created.id;
  });
  if (!r.ok) return r;
  revalidatePath("/units");
  revalidatePath(`/properties/${String(fd.get("propertyId") ?? "")}`);
  redirect(`/units/${id}`);
}

export async function updateUnitAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const r = await runAction(async () => {
    const ctx = await authorize("unit.manage");
    const { t } = await getT(unitMessages);
    const before = await db.unit.findFirst({ where: { ...unitWhere(ctx), id: idField.parse(id) } });
    if (!before) throw new BusinessError(t("unit.err.notFound"));
    if (before.archived) throw new BusinessError(t("unit.err.archived"));
    const data = toData(unitSchema.parse(formToObject(fd)));
    const dup = await db.unit.findFirst({ where: { propertyId: before.propertyId, number: data.number, id: { not: before.id } }, select: { id: true } });
    if (dup) throw new BusinessError(t("unit.err.duplicate"));
    await db.$transaction(async (tx) => {
      await tx.unit.update({ where: { id: before.id }, data });
      await audit(ctx, { action: "unit.updated", module: "units", entityType: "Unit", entityId: before.id, propertyId: before.propertyId, before, after: data }, tx);
    });
  });
  if (!r.ok) return r;
  revalidatePath(`/units/${id}`);
  redirect(`/units/${id}`);
}

const statusSchema = z.object({
  id: idField,
  status: z.enum(MANUAL_UNIT_STATUSES),
  reason: z.string().trim().min(3).max(500),
});

export async function changeUnitStatusAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(unitMessages);
  const r = await runAction(async () => {
    const ctx = await authorize("unit.manage");
    const input = statusSchema.parse(formToObject(fd));
    const unit = await db.unit.findFirst({ where: { ...unitWhere(ctx), id: input.id } });
    if (!unit) throw new BusinessError(t("unit.err.notFound"));
    if (unit.archived) throw new BusinessError(t("unit.err.archived"));
    if (unit.status === input.status) throw new BusinessError(t("unit.err.sameStatus"));
    if (input.status === "VACANT" || input.status === "RESERVED") {
      const active = await db.lease.count({ where: { unitId: unit.id, organizationId: ctx.organizationId, status: { in: [...ACTIVE_LEASE] } } });
      if (active) throw new BusinessError(t("unit.err.activeLease"));
    }
    await db.$transaction(async (tx) => {
      await tx.unit.update({ where: { id: unit.id }, data: { status: input.status } });
      await tx.unitStatusHistory.create({ data: { unitId: unit.id, from: unit.status, to: input.status, reason: input.reason, actorId: ctx.user.id } });
      await audit(ctx, { action: "unit.status_changed", module: "units", entityType: "Unit", entityId: unit.id, propertyId: unit.propertyId, before: { status: unit.status }, after: { status: input.status }, metadata: { reason: input.reason } }, tx);
    });
    revalidatePath(`/units/${unit.id}`);
    revalidatePath("/units");
  });
  return r.ok ? { ...r, message: t("unit.statusChanged") } : r;
}

/** Units are archived, never deleted; refused while a lease is active or pending. */
export async function archiveUnitAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(unitMessages);
  const r = await runAction(async () => {
    const ctx = await authorize("unit.manage");
    const id = idField.parse(fd.get("id"));
    const unit = await db.unit.findFirst({ where: { ...unitWhere(ctx), id } });
    if (!unit) throw new BusinessError(t("unit.err.notFound"));
    if (unit.archived) throw new BusinessError(t("unit.err.archived"));
    const blocking = await db.lease.count({ where: { unitId: unit.id, organizationId: ctx.organizationId, status: { in: [...BLOCKING_LEASE] } } });
    if (blocking) throw new BusinessError(t("unit.err.archiveActiveLease"));
    await db.$transaction(async (tx) => {
      await tx.unit.update({ where: { id: unit.id }, data: { archived: true } });
      await audit(ctx, { action: "unit.archived", module: "units", entityType: "Unit", entityId: unit.id, propertyId: unit.propertyId, before: { archived: false }, after: { archived: true } }, tx);
    });
    revalidatePath(`/units/${unit.id}`);
    revalidatePath("/units");
  });
  return r.ok ? { ...r, message: t("unit.archivedOk") } : r;
}
