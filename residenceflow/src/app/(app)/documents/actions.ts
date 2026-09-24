"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPropertyAccess, authorize, leaseWhere, tenantWhere } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/action";
import { BusinessError } from "@/lib/errors";
import { canAccessDocument, storeDocument } from "@/lib/storage";
import { DOCUMENT_CATEGORIES } from "./scope";

const opt = z.union([z.literal(""), z.string().uuid()]).default("");
const schema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  name: z.string().trim().max(200).default(""),
  propertyId: opt,
  tenantId: opt,
  leaseId: opt,
  expiresAt: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(""),
  visibleToTenant: z.boolean(),
  sensitive: z.boolean(),
  previousId: opt,
});

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

export async function uploadDocumentAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let id = "";
  const r = await runAction(async () => {
    const ctx = await authorize("document.upload");
    const d = schema.parse({
      category: s(fd, "category"),
      name: s(fd, "name") ?? "",
      propertyId: s(fd, "propertyId") ?? "",
      tenantId: s(fd, "tenantId") ?? "",
      leaseId: s(fd, "leaseId") ?? "",
      expiresAt: s(fd, "expiresAt") ?? "",
      visibleToTenant: s(fd, "visibleToTenant") === "on",
      sensitive: s(fd, "sensitive") === "on",
      previousId: s(fd, "previousId") ?? "",
    });
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new BusinessError("doc.err.fileRequired");

    let propertyId = d.propertyId || null;
    let tenantId = d.tenantId || null;
    let leaseId = d.leaseId || null;
    let category: string = d.category ?? "OTHER";
    let workOrderId: string | null = null;

    // New version: inherit the links of the document being replaced (which must be accessible).
    if (d.previousId) {
      const prev = await db.document.findFirst({
        where: { id: d.previousId, organizationId: ctx.organizationId },
        select: { id: true, organizationId: true, tenantId: true, propertyId: true, leaseId: true, workOrderId: true, visibleToTenant: true, sensitive: true, uploadedById: true, category: true },
      });
      if (!prev || !(await canAccessDocument(ctx, prev))) throw new BusinessError("Document not found.");
      const newer = await db.document.count({ where: { organizationId: ctx.organizationId, previousId: prev.id } });
      if (newer > 0) throw new BusinessError("doc.err.notLatest");
      ({ propertyId, tenantId, leaseId, workOrderId, category } = prev);
    } else {
      if (!d.category) throw new BusinessError("doc.err.category");
      if (propertyId) {
        assertPropertyAccess(ctx, propertyId);
        const p = await db.property.findFirst({ where: { id: propertyId, organizationId: ctx.organizationId }, select: { id: true } });
        if (!p) throw new BusinessError("Building not found.");
      }
      if (tenantId) {
        const tn = await db.tenant.findFirst({ where: { ...tenantWhere(ctx), id: tenantId }, select: { id: true } });
        if (!tn) throw new BusinessError("Tenant not found.");
      }
      if (leaseId) {
        const l = await db.lease.findFirst({ where: { ...leaseWhere(ctx), id: leaseId }, select: { id: true, tenantId: true } });
        if (!l) throw new BusinessError("Lease not found.");
        tenantId = tenantId ?? l.tenantId;
      }
      // Building-scoped staff must link documents to something inside their scope.
      if (ctx.propertyIds !== "ALL" && !propertyId && !tenantId && !leaseId) throw new BusinessError("doc.err.linkRequired");
    }
    if (d.visibleToTenant && !tenantId) throw new BusinessError("doc.err.tenantForVisibility");

    const doc = await storeDocument(ctx, {
      file,
      name: d.name || undefined,
      category,
      propertyId,
      tenantId,
      leaseId,
      workOrderId,
      visibleToTenant: d.visibleToTenant,
      sensitive: d.sensitive,
      expiresAt: d.expiresAt ? new Date(`${d.expiresAt}T00:00:00Z`) : null,
      previousId: d.previousId || null,
    });
    id = doc.id;
  });
  if (!r.ok) return r;
  revalidatePath("/documents");
  redirect(`/documents/${id}`);
}
