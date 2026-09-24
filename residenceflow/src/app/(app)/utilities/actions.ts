"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, byPropertyWhere, type AuthContext } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { money, toDb } from "@/lib/money";
import { storeDocument } from "@/lib/storage";
import { getOrgSettings } from "@/lib/settings";
import { getT } from "@/i18n";
import { resolveLocation } from "@/services/maintenance";
import { createInvoice, todayUtc } from "@/services/billing";
import { addDays } from "@/domain/schedule";
import { UTILITY_TYPES, computeConsumption, computeUtilityAmount, parseReadingCsv } from "@/domain/utilities";
import { utilitiesEnabled } from "./flag";
import { utilityMessages } from "./messages";

const optUuid = z.union([z.literal(""), z.string().uuid()]).optional().transform((v) => v || null);
const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const toDay = (s: string) => new Date(`${s}T00:00:00Z`);

async function guard(perm: Parameters<typeof authorize>[0]) {
  const ctx = await authorize(perm);
  if (!(await utilitiesEnabled(ctx.organizationId))) throw new BusinessError("The utilities module is disabled.");
  return ctx;
}

const meterSchema = z.object({
  propertyId: z.string().uuid(),
  unitId: optUuid,
  utility: z.enum(UTILITY_TYPES),
  serial: z.string().trim().min(1).max(80),
  tariff: z.string().trim().regex(/^\d+(\.\d{1,4})?$/, "Invalid tariff"),
  fixedFee: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Invalid fee").default("0"),
});

export async function createMeterAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let meterId = "";
  const r = await runAction(async () => {
    const ctx = await guard("unit.manage");
    const d = meterSchema.parse(formToObject(fd));
    await resolveLocation(ctx, d.propertyId, d.unitId);
    const dup = await db.meter.findFirst({ where: { organizationId: ctx.organizationId, serial: d.serial }, select: { id: true } });
    if (dup) throw new BusinessError("A meter with this serial number already exists.");
    await db.$transaction(async (tx) => {
      const m = await tx.meter.create({
        data: { organizationId: ctx.organizationId, propertyId: d.propertyId, unitId: d.unitId, utility: d.utility, serial: d.serial, tariff: money(d.tariff).toFixed(4), fixedFee: toDb(d.fixedFee) },
      });
      meterId = m.id;
      await audit(ctx, { action: "meter.created", module: "utilities", entityType: "Meter", entityId: m.id, propertyId: d.propertyId, after: d }, tx);
    });
  });
  if (!r.ok) return r;
  revalidatePath("/utilities");
  redirect(`/utilities/${meterId}`);
}

async function loadMeter(ctx: AuthContext, id: string, tx: Tx = db) {
  const m = await tx.meter.findFirst({ where: { ...byPropertyWhere(ctx), id } });
  if (!m) throw new BusinessError("Meter not found.");
  return m;
}

/** Latest reading strictly before the given date (or same date, created earlier). */
async function previousReading(tx: Tx, meterId: string, before: Date, excludeId?: string) {
  return tx.meterReading.findFirst({
    where: { meterId, readingDate: { lte: before }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: [{ readingDate: "desc" }, { createdAt: "desc" }],
  });
}

async function insertReading(ctx: AuthContext, tx: Tx, meter: { id: string; propertyId: string }, date: Date, value: string, t: (k: string, v?: Record<string, string | number>) => string) {
  const prev = await previousReading(tx, meter.id, date);
  if (prev && money(value).lt(money(prev.value))) throw new BusinessError(t("util.valueBelowPrevious", { prev: money(prev.value).toFixed(3) }));
  const reading = await tx.meterReading.create({ data: { meterId: meter.id, readingDate: date, value: money(value).toFixed(3), recordedById: ctx.user.id } });
  await audit(ctx, { action: "meter.reading_added", module: "utilities", entityType: "MeterReading", entityId: reading.id, propertyId: meter.propertyId, after: { meterId: meter.id, date: date.toISOString().slice(0, 10), value } }, tx);
  return reading;
}

const readingSchema = z.object({ meterId: z.string().uuid(), readingDate: dayStr, value: z.string().trim().regex(/^\d+(\.\d{1,3})?$/, "Invalid value") });

export async function addReadingAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(utilityMessages);
  const r = await runAction(async () => {
    const ctx = await guard("unit.manage");
    const d = readingSchema.parse(formToObject(fd));
    const meter = await loadMeter(ctx, d.meterId);
    const file = fd.get("photo");
    await db.$transaction(async (tx) => {
      const reading = await insertReading(ctx, tx, meter, toDay(d.readingDate), d.value, t);
      if (file instanceof File && file.size > 0) {
        const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5);
        const doc = await storeDocument(ctx, { file, category: "OTHER", name: `meter-${meter.id}-${d.readingDate}.${ext}`, propertyId: meter.propertyId }, tx);
        await tx.meterReading.update({ where: { id: reading.id }, data: { photoDocumentId: doc.id } });
      }
    });
    revalidatePath(`/utilities/${meter.id}`);
  });
  return r.ok ? { ...r, message: t("util.readingSaved") } : r;
}

export interface ImportResult {
  imported: number;
  errors: { line: number; error: string }[];
}

export async function importReadingsAction(_p: ActionResult<ImportResult> | null, fd: FormData): Promise<ActionResult<ImportResult>> {
  const { t } = await getT(utilityMessages);
  return runAction<ImportResult>(async () => {
    const ctx = await guard("unit.manage");
    const csv = z.string().min(1).max(200_000).parse(fd.get("csv"));
    const { rows, errors } = parseReadingCsv(csv);
    const serials = [...new Set(rows.map((r) => r.serial))];
    const meters = await db.meter.findMany({ where: { ...byPropertyWhere(ctx), serial: { in: serials } }, select: { id: true, propertyId: true, serial: true } });
    const bySerial = new Map(meters.map((m) => [m.serial, m]));
    let imported = 0;
    // Sort by date so that multi-row imports for one meter validate in order.
    for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
      const meter = bySerial.get(row.serial);
      if (!meter) {
        errors.push({ line: row.line, error: `${t("util.unknownSerial")}: ${row.serial}` });
        continue;
      }
      try {
        await db.$transaction((tx) => insertReading(ctx, tx, meter, toDay(row.date), row.value, t));
        imported++;
      } catch (e) {
        errors.push({ line: row.line, error: e instanceof BusinessError ? e.message : "Could not save this row." });
      }
    }
    errors.sort((a, b) => a.line - b.line);
    await audit(ctx, { action: "meter.readings_imported", module: "utilities", entityType: "Meter", metadata: { imported, rejected: errors.length } });
    revalidatePath("/utilities");
    return { imported, errors };
  });
}

export async function billReadingAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { t } = await getT(utilityMessages);
  const r = await runAction(async () => {
    const ctx = await guard("invoice.create");
    const readingId = z.string().uuid().parse(fd.get("readingId"));
    const reading = await db.meterReading.findFirst({ where: { id: readingId, meter: byPropertyWhere(ctx) }, include: { meter: true, charge: true } });
    if (!reading) throw new BusinessError("Reading not found.");
    if (reading.charge) throw new BusinessError(t("util.alreadyBilled"));
    const meter = reading.meter;
    if (!meter.unitId) throw new BusinessError(t("util.sharedNoBill"));
    const lease = await db.lease.findFirst({
      where: { organizationId: ctx.organizationId, unitId: meter.unitId, status: { in: ["ACTIVE", "NOTICE_GIVEN"] } },
      orderBy: { startDate: "desc" },
      select: { id: true, tenantId: true, graceDays: true, currency: true },
    });
    if (!lease) throw new BusinessError(t("util.noLease"));
    const settings = await getOrgSettings(ctx.organizationId);
    await db.$transaction(async (tx) => {
      const prev = await previousReading(tx, meter.id, reading.readingDate, reading.id);
      const consumption = computeConsumption(prev?.value ?? null, reading.value);
      const amount = computeUtilityAmount(consumption, meter.tariff, meter.fixedFee);
      if (amount.lte(0)) throw new BusinessError("Nothing to bill: the computed amount is zero.");
      const today = todayUtc();
      const description = `${meter.utility} ${meter.serial} ${prev ? money(prev.value).toFixed(3) : "0.000"}→${money(reading.value).toFixed(3)} (${consumption.toFixed(3)})`;
      const { invoice } = await createInvoice(tx, ctx, {
        organizationId: ctx.organizationId,
        tenantId: lease.tenantId,
        leaseId: lease.id,
        issueDate: today,
        dueDate: addDays(today, Math.max(lease.graceDays, 1)),
        lines: [{ chargeType: "UTILITIES", description, quantity: 1, unitPrice: amount.toFixed(2) }],
        issue: true,
        idempotencyKey: `utility:${reading.id}`,
        currency: lease.currency || settings?.currency || "XAF",
        taxRatePercent: 0,
      });
      const charge = await tx.utilityCharge.create({
        data: { organizationId: ctx.organizationId, meterId: meter.id, readingId: reading.id, leaseId: lease.id, consumption: consumption.toFixed(3), amount: toDb(amount), invoiceId: invoice.id },
      });
      await audit(ctx, { action: "utility.billed", module: "utilities", entityType: "UtilityCharge", entityId: charge.id, propertyId: meter.propertyId, after: { readingId: reading.id, invoiceId: invoice.id, consumption: consumption.toFixed(3), amount: amount.toFixed(2) } }, tx);
    });
    revalidatePath(`/utilities/${meter.id}`);
  });
  return r.ok ? { ...r, message: t("util.billedMsg") } : r;
}
