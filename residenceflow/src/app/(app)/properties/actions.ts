"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, assertPropertyAccess } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { nextNumber } from "@/lib/numbering";

const propertySchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(["RESIDENTIAL", "MIXED_USE", "COMPOUND", "HOUSE", "COMMERCIAL"]),
  address: z.string().trim().max(300).default(""),
  city: z.string().trim().max(100).default(""),
  description: z.string().trim().max(2000).default(""),
  floors: z.coerce.number().int().min(0).max(200).default(1),
  blocks: z.coerce.number().int().min(1).max(100).default(1),
  amenities: z.string().trim().max(1000).default(""),
  utilities: z.string().trim().max(1000).default(""),
  status: z.enum(["ACTIVE", "INACTIVE", "RENOVATION"]).default("ACTIVE"),
  latitude: z.union([z.literal(""), z.coerce.number().min(-90).max(90)]).optional(),
  longitude: z.union([z.literal(""), z.coerce.number().min(-180).max(180)]).optional(),
  notes: z.string().trim().max(4000).default(""),
  ownerId: z.string().uuid().or(z.literal("")).optional(),
});

function toData(d: z.infer<typeof propertySchema>) {
  return {
    ...d,
    amenities: d.amenities.split(",").map((s) => s.trim()).filter(Boolean),
    latitude: d.latitude === "" || d.latitude === undefined ? null : String(d.latitude),
    longitude: d.longitude === "" || d.longitude === undefined ? null : String(d.longitude),
    ownerId: d.ownerId || null,
  };
}

export async function createPropertyAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    const ctx = await authorize("building.create");
    const data = toData(propertySchema.parse(formToObject(fd)));
    if (data.ownerId) {
      const owner = await db.user.findFirst({ where: { id: data.ownerId, organizationId: ctx.organizationId } });
      if (!owner) throw new BusinessError("Owner not found.");
    }
    const created = await db.$transaction(async (tx) => {
      const reference = await nextNumber(ctx.organizationId, "PROPERTY", tx);
      const p = await tx.property.create({ data: { ...data, reference, organizationId: ctx.organizationId } });
      // Building-scoped creators keep access to what they create.
      if (ctx.propertyIds !== "ALL") await tx.userPropertyScope.create({ data: { userId: ctx.user.id, propertyId: p.id } });
      await audit(ctx, { action: "building.created", module: "properties", entityType: "Property", entityId: p.id, propertyId: p.id, after: data }, tx);
      return p;
    });
    id = created.id;
  });
  if (!r.ok) return r;
  revalidatePath("/properties");
  redirect(`/properties/${id}`);
}

export async function updatePropertyAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const r = await runAction(async () => {
    const ctx = await authorize("building.update");
    assertPropertyAccess(ctx, id);
    const before = await db.property.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw new BusinessError("Building not found.");
    const data = toData(propertySchema.parse(formToObject(fd)));
    await db.property.update({ where: { id }, data });
    await audit(ctx, { action: "building.updated", module: "properties", entityType: "Property", entityId: id, propertyId: id, before, after: data });
  });
  if (!r.ok) return r;
  revalidatePath(`/properties/${id}`);
  redirect(`/properties/${id}`);
}

/** Buildings are archived, never deleted, so they stay available in historical reports. */
export async function archivePropertyAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("building.archive");
    const id = z.string().uuid().parse(fd.get("id"));
    assertPropertyAccess(ctx, id);
    const active = await db.lease.count({ where: { organizationId: ctx.organizationId, unit: { propertyId: id }, status: { in: ["ACTIVE", "NOTICE_GIVEN", "PENDING_APPROVAL"] } } });
    if (active) throw new BusinessError("This building still has active leases.");
    const p = await db.property.update({ where: { id, organizationId: ctx.organizationId }, data: { status: "ARCHIVED" } });
    await audit(ctx, { action: "building.archived", module: "properties", entityType: "Property", entityId: id, propertyId: id, after: { status: p.status } });
    revalidatePath("/properties");
  }).then((r) => (r.ok ? { ...r, message: "Building archived." } : r));
}
