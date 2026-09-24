import "server-only";
import { createHash } from "node:crypto";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { BusinessError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";

/**
 * Document storage. Files are stored in PostgreSQL (bytea) so the app runs on Vercel without extra
 * infrastructure. To use S3-compatible storage, implement `putObject/getObject` against
 * STORAGE_ENDPOINT/BUCKET and keep this module's API unchanged.
 */
export const ALLOWED_DOCUMENT_TYPES: Record<string, number[][]> = {
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47]],
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [[0x50, 0x4b, 0x03, 0x04]],
  "text/csv": [],
};
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024; // Vercel request body limit is 4.5 MB

export function validateUpload(bytes: Uint8Array, mime: string, name: string): string | null {
  if (!(mime in ALLOWED_DOCUMENT_TYPES)) return "File type not allowed (PDF, PNG, JPEG, WebP, DOCX, CSV).";
  if (bytes.byteLength === 0) return "The file is empty.";
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return "The file exceeds 4 MB.";
  if (/[\\/]/.test(name) || name.length > 200) return "Invalid file name.";
  const sigs = ALLOWED_DOCUMENT_TYPES[mime];
  if (sigs.length && !sigs.some((sig) => sig.every((b, i) => bytes[i] === b))) return "File content does not match its type.";
  return null;
}

/** Hook for antivirus scanning (e.g. ClamAV / cloud scanner). Returns scan status. */
async function scanForMalware(_bytes: Uint8Array): Promise<"NOT_SCANNED" | "CLEAN" | "INFECTED"> {
  void _bytes;
  return "NOT_SCANNED";
}

export interface StoreDocumentInput {
  file: File;
  category: string;
  name?: string;
  tenantId?: string | null;
  propertyId?: string | null;
  leaseId?: string | null;
  workOrderId?: string | null;
  visibleToTenant?: boolean;
  sensitive?: boolean;
  expiresAt?: Date | null;
  previousId?: string | null;
}

export async function storeDocument(ctx: AuthContext, input: StoreDocumentInput, tx: Tx = db) {
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const name = (input.name || input.file.name || "document").slice(0, 200);
  const err = validateUpload(bytes, input.file.type, name);
  if (err) throw new BusinessError(err);
  const scanStatus = await scanForMalware(bytes);
  if (scanStatus === "INFECTED") throw new BusinessError("The file was rejected by the malware scanner.");
  let version = 1;
  if (input.previousId) {
    const prev = await tx.document.findFirst({ where: { id: input.previousId, organizationId: ctx.organizationId } });
    if (prev) version = prev.version + 1;
  }
  const doc = await tx.document.create({
    data: {
      organizationId: ctx.organizationId,
      category: input.category,
      name,
      mimeType: input.file.type,
      size: bytes.byteLength,
      content: Buffer.from(bytes),
      checksum: createHash("sha256").update(bytes).digest("hex"),
      tenantId: input.tenantId ?? null,
      propertyId: input.propertyId ?? null,
      leaseId: input.leaseId ?? null,
      workOrderId: input.workOrderId ?? null,
      visibleToTenant: input.visibleToTenant ?? false,
      sensitive: input.sensitive ?? false,
      expiresAt: input.expiresAt ?? null,
      previousId: input.previousId ?? null,
      version,
      scanStatus,
      uploadedById: ctx.user.id,
    },
    select: { id: true, name: true },
  });
  await audit(ctx, { action: "document.uploaded", module: "documents", entityType: "Document", entityId: doc.id, metadata: { category: input.category, name } }, tx);
  return doc;
}

type DocMeta = {
  organizationId: string;
  tenantId: string | null;
  propertyId: string | null;
  leaseId: string | null;
  workOrderId: string | null;
  visibleToTenant: boolean;
  sensitive: boolean;
  uploadedById: string | null;
};

/** Record-level access rule for documents (used by the download route and lists). */
export async function canAccessDocument(ctx: AuthContext, doc: DocMeta): Promise<boolean> {
  if (doc.organizationId !== ctx.organizationId) return false;
  if (doc.uploadedById === ctx.user.id) return true;
  // Tenant portal: own, tenant-visible documents only.
  if (!ctx.permissions.has("document.view") && ctx.tenantId) {
    return doc.tenantId === ctx.tenantId && doc.visibleToTenant && !doc.sensitive;
  }
  // Technicians / vendors: evidence on their assigned work orders.
  if (doc.workOrderId && ctx.permissions.has("maintenance.view")) {
    const wo = await db.maintenanceRequest.findFirst({
      where: { id: doc.workOrderId, organizationId: ctx.organizationId },
      select: { assignedToId: true, vendorId: true, propertyId: true },
    });
    if (wo && (wo.assignedToId === ctx.user.id || (ctx.vendorId && wo.vendorId === ctx.vendorId))) return true;
    if (wo && ctx.scope !== "OWN" && (ctx.propertyIds === "ALL" || ctx.propertyIds.includes(wo.propertyId))) return true;
  }
  if (!ctx.permissions.has("document.view")) return false;
  if (doc.sensitive && !ctx.permissions.has("document.sensitive.view")) return false;
  if (ctx.propertyIds === "ALL") return true;
  if (doc.propertyId) return ctx.propertyIds.includes(doc.propertyId);
  if (doc.leaseId) {
    const lease = await db.lease.findFirst({ where: { id: doc.leaseId }, select: { unit: { select: { propertyId: true } } } });
    return !!lease && ctx.propertyIds.includes(lease.unit.propertyId);
  }
  if (doc.tenantId) {
    const n = await db.lease.count({ where: { tenantId: doc.tenantId, unit: { propertyId: { in: ctx.propertyIds } } } });
    return n > 0;
  }
  return false;
}
