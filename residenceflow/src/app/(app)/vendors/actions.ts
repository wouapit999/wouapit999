"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/auth/context";
import { runAction, formToObject, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { getT } from "@/i18n";
import { VENDOR_CATEGORIES } from "./vendor-form";
import { vendorMessages } from "./messages";

const vendorSchema = z.object({
  name: z.string().trim().min(2).max(150),
  category: z.enum(VENDOR_CATEGORIES),
  contactName: z.string().trim().max(120).default(""),
  email: z.union([z.literal(""), z.string().trim().email().max(200)]).default(""),
  phone: z.string().trim().max(40).default(""),
  taxId: z.string().trim().max(60).default(""),
  notes: z.string().trim().max(4000).default(""),
});

export async function createVendorAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    const ctx = await authorize("vendor.manage");
    const data = vendorSchema.parse(formToObject(fd));
    const v = await db.$transaction(async (tx) => {
      const v = await tx.vendor.create({ data: { ...data, organizationId: ctx.organizationId } });
      await audit(ctx, { action: "vendor.created", module: "vendors", entityType: "Vendor", entityId: v.id, after: data }, tx);
      return v;
    });
    id = v.id;
  });
  if (!r.ok) return r;
  revalidatePath("/vendors");
  redirect(`/vendors/${id}`);
}

export async function updateVendorAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const r = await runAction(async () => {
    const ctx = await authorize("vendor.manage");
    z.string().uuid().parse(id);
    const before = await db.vendor.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw new BusinessError("Vendor not found.");
    const data = vendorSchema.parse(formToObject(fd));
    await db.$transaction(async (tx) => {
      await tx.vendor.update({ where: { id }, data });
      await audit(ctx, { action: "vendor.updated", module: "vendors", entityType: "Vendor", entityId: id, before, after: data }, tx);
    });
  });
  if (!r.ok) return r;
  revalidatePath(`/vendors/${id}`);
  redirect(`/vendors/${id}`);
}

/** Ending the relationship revokes access: every user linked to the vendor is suspended and signed out. */
export async function deactivateVendorAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("vendor.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    const vendor = await db.vendor.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!vendor) throw new BusinessError("Vendor not found.");
    if (vendor.status === "INACTIVE") throw new BusinessError("The vendor is already inactive.");
    await db.$transaction(async (tx) => {
      await tx.vendor.update({ where: { id }, data: { status: "INACTIVE" } });
      const users = await tx.user.findMany({ where: { vendorId: id, organizationId: ctx.organizationId, status: { not: "SUSPENDED" } }, select: { id: true, status: true } });
      if (users.length) {
        await tx.user.updateMany({ where: { id: { in: users.map((u) => u.id) } }, data: { status: "SUSPENDED" } });
        await tx.session.updateMany({ where: { userId: { in: users.map((u) => u.id) }, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await audit(ctx, { action: "vendor.deactivated", module: "vendors", entityType: "Vendor", entityId: id, before: { status: vendor.status }, after: { status: "INACTIVE" }, metadata: { suspendedUsers: users.length } }, tx);
      for (const u of users) {
        await audit(ctx, { action: "user.suspended", module: "users", entityType: "User", entityId: u.id, before: { status: u.status }, after: { status: "SUSPENDED" }, metadata: { reason: "vendor_deactivated", vendorId: id } }, tx);
      }
    });
    revalidatePath(`/vendors/${id}`);
    revalidatePath("/vendors");
  }).then(async (r) => (r.ok ? { ...r, message: (await getT(vendorMessages)).t("ven.deactivated") } : r));
}

export async function reactivateVendorAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await authorize("vendor.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    const vendor = await db.vendor.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!vendor) throw new BusinessError("Vendor not found.");
    await db.$transaction(async (tx) => {
      await tx.vendor.update({ where: { id }, data: { status: "ACTIVE" } });
      await audit(ctx, { action: "vendor.reactivated", module: "vendors", entityType: "Vendor", entityId: id, before: { status: vendor.status }, after: { status: "ACTIVE" } }, tx);
    });
    revalidatePath(`/vendors/${id}`);
  }).then(async (r) => (r.ok ? { ...r, message: (await getT(vendorMessages)).t("ven.reactivated") } : r));
}
