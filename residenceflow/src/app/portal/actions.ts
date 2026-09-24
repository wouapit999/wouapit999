"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, type AuthContext } from "@/lib/auth/context";
import { runAction, withMessage, type ActionResult } from "@/lib/action";
import { BusinessError, ForbiddenError } from "@/lib/errors";
import { storeDocument } from "@/lib/storage";
import { recordPayment } from "@/services/billing";
import {
  COMM_CHANNELS,
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  confirmCompletion,
  createPortalMaintenanceRequest,
  currentLease,
  dayIso,
  isOccupant,
  parseDayString,
  rateRequest,
  reopenRequest,
  sendTenantMessage,
  staffUserIds,
  notifyDirect,
  todayUtcDay,
  updateTenantContactPrefs,
} from "@/services/portal";

/** Server-action guard for portal users: throws instead of redirecting. */
async function portalActor(opts: { financial?: boolean } = {}): Promise<{ ctx: AuthContext; tenantId: string }> {
  const ctx = await authorize("portal.access");
  if (!ctx.tenantId) throw new ForbiddenError("no_tenant");
  if (opts.financial && isOccupant(ctx)) throw new ForbiddenError("occupant");
  return { ctx, tenantId: ctx.tenantId };
}

const text = (max: number) => z.string().trim().max(max).default("");
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const fileOf = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v instanceof File && v.size > 0 ? v : null;
};

// ───────────────────────── Messages ─────────────────────────

const messageSchema = z.object({ subject: text(150), body: z.string().trim().min(1).max(4000) });

export async function sendPortalMessageAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const { ctx, tenantId } = await portalActor();
    const input = messageSchema.parse({ subject: str(fd, "subject"), body: str(fd, "body") });
    await sendTenantMessage(ctx, tenantId, input);
  });
  revalidatePath("/portal/messages");
  return withMessage(r, "portal.msg.sent");
}

// ───────────────────────── Lease: notice to vacate ─────────────────────────

const noticeSchema = z.object({ desiredDate: z.string().trim(), reason: text(2000) });

export async function noticeToVacateAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const { ctx, tenantId } = await portalActor({ financial: true });
    const input = noticeSchema.parse({ desiredDate: str(fd, "desiredDate"), reason: str(fd, "reason") });
    const date = parseDayString(input.desiredDate);
    if (!date) throw new BusinessError("portal.err.invalidDate");
    if (date < todayUtcDay()) throw new BusinessError("portal.err.pastDate");
    const lease = await currentLease(ctx.organizationId, tenantId);
    if (!lease) throw new BusinessError("portal.err.noLease");
    const noticeDays = Math.round((date.getTime() - todayUtcDay().getTime()) / 86_400_000);
    const short = noticeDays < lease.noticeDays;
    const body = [
      `Desired move-out date / Date de départ souhaitée: ${dayIso(date)}`,
      `Lease / Bail: ${lease.reference} — ${lease.unit.property.name} ${lease.unit.number}`,
      `Notice given: ${noticeDays} day(s); contractual notice period: ${lease.noticeDays} day(s)${short ? " (SHORTER THAN REQUIRED)" : ""}`,
      input.reason ? `\n${input.reason}` : "",
    ].join("\n");
    await sendTenantMessage(ctx, tenantId, { subject: "Notice to vacate", body });
    await audit(ctx, {
      action: "lease.notice_requested", module: "portal", entityType: "Lease", entityId: lease.id, propertyId: lease.unit.propertyId,
      metadata: { desiredDate: dayIso(date), noticeDays, contractualNoticeDays: lease.noticeDays },
    });
  });
  revalidatePath("/portal/lease");
  return withMessage(r, "portal.lease.noticeSent");
}

// ───────────────────────── Payments: proof submission ─────────────────────────

const proofSchema = z.object({
  amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Invalid amount"),
  paymentDate: z.string().trim(),
  method: z.string().trim().min(1).max(40),
  reference: z.string().trim().min(2).max(100),
  notes: text(1000),
});

export async function submitPaymentProofAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const { ctx, tenantId } = await portalActor({ financial: true });
    const input = proofSchema.parse({
      amount: str(fd, "amount"),
      paymentDate: str(fd, "paymentDate"),
      method: str(fd, "method"),
      reference: str(fd, "reference"),
      notes: str(fd, "notes"),
    });
    const date = parseDayString(input.paymentDate);
    if (!date) throw new BusinessError("portal.err.invalidDate");
    if (date > todayUtcDay()) throw new BusinessError("portal.err.futureDate");
    const settings = await db.organizationSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { enabledPaymentMethods: true } });
    const enabled = (settings?.enabledPaymentMethods ?? []).filter((m) => m !== "CASH");
    if (!enabled.includes(input.method)) throw new BusinessError("portal.err.method");
    if (Number(input.amount) <= 0) throw new BusinessError("portal.err.amount");
    const proof = fileOf(fd, "proof");
    if (!proof) throw new BusinessError("portal.err.proofRequired");
    const lease = await currentLease(ctx.organizationId, tenantId);
    const doc = await storeDocument(ctx, {
      file: proof,
      category: "PAYMENT_PROOF",
      name: `proof-${dayIso(date)}-${proof.name}`.slice(0, 200).replace(/[\\/]/g, "_"),
      tenantId,
      leaseId: lease?.id ?? null,
      propertyId: lease?.unit.propertyId ?? null,
      visibleToTenant: true,
    });
    const res = await recordPayment(ctx, {
      tenantId,
      leaseId: lease?.id ?? null,
      amount: input.amount,
      paymentDate: date,
      method: input.method,
      externalRef: input.reference,
      notes: input.notes,
      proofDocumentId: doc.id,
      confirmNow: false,
      submittedByTenant: true,
    });
    const staff = await staffUserIds(ctx.organizationId, "payment.approve", lease?.unit.propertyId);
    await notifyDirect(ctx.organizationId, staff, {
      en: { title: `Payment proof submitted (${res.payment.reference})`, body: `${ctx.user.name}: ${input.amount} — ${input.method}, ref ${input.reference}` },
      fr: { title: `Preuve de paiement soumise (${res.payment.reference})`, body: `${ctx.user.name} : ${input.amount} — ${input.method}, réf. ${input.reference}` },
    }, "/payments", db, "PAYMENT_SUBMITTED");
  });
  revalidatePath("/portal/payments");
  return withMessage(r, "portal.pay.submitted");
}

// ───────────────────────── Profile ─────────────────────────

const phone = z.string().trim().max(40).regex(/^[+0-9 ()./-]*$/, "Invalid phone number");
const profileSchema = z.object({
  phone,
  altPhone: phone,
  language: z.enum(["en", "fr"]),
  commPreferences: z.array(z.enum(COMM_CHANNELS)).max(COMM_CHANNELS.length),
});

export async function updatePortalProfileAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const { ctx, tenantId } = await portalActor();
    if (isOccupant(ctx)) throw new ForbiddenError("occupant");
    const input = profileSchema.parse({
      phone: str(fd, "phone") ?? "",
      altPhone: str(fd, "altPhone") ?? "",
      language: str(fd, "language"),
      commPreferences: fd.getAll("commPreferences").map(String),
    });
    await updateTenantContactPrefs(ctx, tenantId, input);
  });
  revalidatePath("/portal/profile");
  return withMessage(r, "portal.profile.saved");
}

const changeRequestSchema = z.object({
  legalName: text(200),
  email: z.union([z.literal(""), z.string().trim().email().max(200)]),
  details: text(2000),
});

export async function profileChangeRequestAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const { ctx, tenantId } = await portalActor();
    const input = changeRequestSchema.parse({ legalName: str(fd, "legalName") ?? "", email: str(fd, "email") ?? "", details: str(fd, "details") ?? "" });
    if (!input.legalName && !input.email) throw new BusinessError("portal.err.changeEmpty");
    const body = [
      input.legalName ? `New legal name / Nouveau nom légal: ${input.legalName}` : "",
      input.email ? `New email / Nouvel e-mail: ${input.email}` : "",
      input.details ? `\n${input.details}` : "",
    ].filter(Boolean).join("\n");
    await sendTenantMessage(ctx, tenantId, { subject: "Profile change request", body });
    await audit(ctx, { action: "tenant.change_requested", module: "portal", entityType: "Tenant", entityId: tenantId, metadata: { fields: [input.legalName && "legalName", input.email && "email"].filter(Boolean) } });
  });
  return withMessage(r, "portal.profile.requestSent");
}

// ───────────────────────── Maintenance ─────────────────────────

const maintenanceSchema = z.object({
  category: z.enum(MAINTENANCE_CATEGORIES),
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(5).max(4000),
  location: text(200),
  priority: z.enum(MAINTENANCE_PRIORITIES),
  safetyIssue: z.boolean(),
  accessPreference: text(300),
  availableTimes: text(300),
});

export async function createPortalMaintenanceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    const { ctx, tenantId } = await portalActor();
    const input = maintenanceSchema.parse({
      category: str(fd, "category"),
      title: str(fd, "title"),
      description: str(fd, "description"),
      location: str(fd, "location") ?? "",
      priority: str(fd, "priority") ?? "NORMAL",
      safetyIssue: str(fd, "safetyIssue") === "on",
      accessPreference: str(fd, "accessPreference") ?? "",
      availableTimes: str(fd, "availableTimes") ?? "",
    });
    const req = await createPortalMaintenanceRequest(ctx, tenantId, { ...input, photo: fileOf(fd, "photo") });
    id = req.id;
  });
  if (!r.ok) return r;
  revalidatePath("/portal/maintenance");
  redirect(`/portal/maintenance/${id}?created=1`);
}

const idSchema = z.string().uuid();
const ratingSchema = z.union([z.literal(""), z.coerce.number().int().min(1).max(5)]).optional();

export async function confirmMaintenanceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const r = await runAction(async () => {
    const { ctx, tenantId } = await portalActor();
    const rating = ratingSchema.parse(str(fd, "rating") ?? "");
    await confirmCompletion(ctx, tenantId, idSchema.parse(id), typeof rating === "number" ? rating : null, text(500).parse(str(fd, "comment") ?? ""));
  });
  revalidatePath(`/portal/maintenance/${id}`);
  return withMessage(r, "portal.mnt.confirmed");
}

export async function reopenMaintenanceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const r = await runAction(async () => {
    const { ctx, tenantId } = await portalActor();
    await reopenRequest(ctx, tenantId, idSchema.parse(id), z.string().trim().min(3).max(1000).parse(str(fd, "reason") ?? ""));
  });
  revalidatePath(`/portal/maintenance/${id}`);
  return withMessage(r, "portal.mnt.reopened");
}

export async function rateMaintenanceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const r = await runAction(async () => {
    const { ctx, tenantId } = await portalActor();
    const rating = z.coerce.number().int().min(1).max(5).parse(str(fd, "rating"));
    await rateRequest(ctx, tenantId, idSchema.parse(id), rating, text(500).parse(str(fd, "comment") ?? ""));
  });
  revalidatePath(`/portal/maintenance/${id}`);
  return withMessage(r, "portal.mnt.rated");
}
