import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth/context";
import { canAccessDocument } from "@/lib/storage";
import { audit } from "@/lib/audit";

/** Authorised download. Every access is checked server-side; sensitive downloads are audited. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const meta = await db.document.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, organizationId: true, tenantId: true, propertyId: true, leaseId: true, workOrderId: true, expenseId: true, visibleToTenant: true, sensitive: true, uploadedById: true, name: true, mimeType: true },
  });
  if (!meta || !(await canAccessDocument(ctx, meta))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const doc = await db.document.findUniqueOrThrow({ where: { id }, select: { content: true } });
  if (meta.sensitive) await audit(ctx, { action: "document.sensitive_accessed", module: "documents", entityType: "Document", entityId: id });
  const inline = new URL(req.url).searchParams.get("inline") === "1" && meta.mimeType !== "text/csv";
  return new NextResponse(new Uint8Array(doc.content), {
    headers: {
      "Content-Type": meta.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
