"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { authorize } from "@/lib/auth/context";
import { runAction, formToObject, withMessage, type ActionResult } from "@/lib/action";
import { getOrgSettings } from "@/lib/settings";
import { BusinessError } from "@/lib/errors";
import { getT } from "@/i18n";
import { maintenanceMessages } from "./messages";
import {
  WO_CATEGORIES,
  WO_PRIORITIES,
  addEvidence,
  addNote,
  approveEstimate,
  assign,
  attachCreationPhoto,
  changeStatus,
  createRequest,
  logWork,
  setEstimate,
} from "@/services/maintenance";

const uuid = z.string().uuid();
const optUuid = z.union([z.literal(""), z.string().uuid()]).optional().transform((v) => v || null);
const bool = z.union([z.literal("on"), z.literal("true"), z.literal("")]).optional().transform((v) => v === "on" || v === "true");
const amount = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Invalid amount");

async function parseLocalDateTime(organizationId: string, value: string | null | undefined) {
  if (!value) return null;
  const settings = await getOrgSettings(organizationId);
  const d = fromZonedTime(value, settings?.timezone ?? "Africa/Douala");
  return Number.isNaN(d.getTime()) ? null : d;
}

function fileFrom(fd: FormData, key: string): File | null {
  const f = fd.get(key);
  return f instanceof File && f.size > 0 ? f : null;
}

const createSchema = z.object({
  propertyId: uuid,
  unitId: optUuid,
  category: z.enum(WO_CATEGORIES),
  priority: z.enum(WO_PRIORITIES),
  safetyIssue: bool,
  onBehalfOfTenant: bool,
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(3).max(4000),
  location: z.string().trim().max(200).default(""),
  accessPreference: z.string().trim().max(300).default(""),
  availableTimes: z.string().trim().max(300).default(""),
});

export async function createRequestAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    const ctx = await authorize("maintenance.create");
    const input = createSchema.parse(formToObject(fd));
    const wo = await createRequest(ctx, input);
    id = wo.id;
    const photo = fileFrom(fd, "photo");
    if (photo) await attachCreationPhoto(ctx, wo.id, photo);
  });
  if (!r.ok) {
    // The request itself may have been created before a photo failed validation.
    if (id) redirect(`/maintenance/${id}`);
    return r;
  }
  revalidatePath("/maintenance");
  redirect(`/maintenance/${id}`);
}

const statusSchema = z.object({
  id: uuid,
  to: z.enum(["TRIAGED", "SCHEDULED", "IN_PROGRESS", "WAITING_PARTS", "WAITING_TENANT", "COMPLETED", "TENANT_CONFIRMATION", "CLOSED", "CANCELLED", "REOPENED"]),
  note: z.string().trim().max(2000).default(""),
  internal: bool,
  scheduledAt: z.string().trim().max(30).optional(),
  completionSummary: z.string().trim().max(4000).default(""),
});

export async function changeStatusAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("maintenance.update");
    const d = statusSchema.parse(formToObject(fd));
    await changeStatus(ctx, { ...d, scheduledAt: await parseLocalDateTime(ctx.organizationId, d.scheduledAt) });
    revalidatePath(`/maintenance/${d.id}`);
  });
  return withMessage(r, "wo.saved");
}

const assignSchema = z.object({
  id: uuid,
  assigneeId: optUuid,
  vendorId: optUuid,
  scheduledAt: z.string().trim().max(30).optional(),
  note: z.string().trim().max(1000).default(""),
});

export async function assignAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("maintenance.assign");
    const d = assignSchema.parse(formToObject(fd));
    await assign(ctx, { ...d, scheduledAt: await parseLocalDateTime(ctx.organizationId, d.scheduledAt) });
    revalidatePath(`/maintenance/${d.id}`);
  });
  return withMessage(r, "wo.saved");
}

const noteSchema = z.object({ id: uuid, note: z.string().trim().min(1).max(2000), internal: bool });

export async function addNoteAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("maintenance.update");
    const d = noteSchema.parse(formToObject(fd));
    await addNote(ctx, d);
    revalidatePath(`/maintenance/${d.id}`);
  });
  return withMessage(r, "wo.saved");
}

const workSchema = z.object({
  id: uuid,
  minutes: z.coerce.number().int().min(0).max(100000).default(0),
  cost: z.union([z.literal(""), amount]).default("").transform((v) => v || "0"),
  note: z.string().trim().max(1000).default(""),
});

export async function logWorkAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("maintenance.update");
    const d = workSchema.parse(formToObject(fd));
    await logWork(ctx, d);
    revalidatePath(`/maintenance/${d.id}`);
  });
  return withMessage(r, "wo.saved");
}

const estimateSchema = z.object({ id: uuid, amount, note: z.string().trim().max(1000).default("") });

export async function setEstimateAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("maintenance.update");
    const d = estimateSchema.parse(formToObject(fd));
    await setEstimate(ctx, d);
    revalidatePath(`/maintenance/${d.id}`);
  });
  return withMessage(r, "wo.saved");
}

export async function approveEstimateAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("maintenance.assign");
    const id = uuid.parse(fd.get("id"));
    await approveEstimate(ctx, { id });
    revalidatePath(`/maintenance/${id}`);
  });
  return withMessage(r, (await getT(maintenanceMessages)).t("wo.saved"));
}

const evidenceSchema = z.object({ id: uuid, phase: z.enum(["BEFORE", "AFTER", "OTHER"]), visibleToTenant: bool });

export async function addEvidenceAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const r = await runAction(async () => {
    const ctx = await authorize("maintenance.update");
    const d = evidenceSchema.parse(formToObject(fd));
    const file = fileFrom(fd, "file");
    if (!file) throw new BusinessError("Choose a file to upload.");
    await addEvidence(ctx, { ...d, file });
    revalidatePath(`/maintenance/${d.id}`);
  });
  return withMessage(r, "wo.saved");
}
