import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { getOrgSettings } from "@/lib/settings";
import { auditWhere, type AuditFilters } from "@/services/admin";

const MAX_ROWS = 10_000;

/** Neutralises spreadsheet formula injection and quotes the value. */
function cell(v: unknown) {
  let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (ctx.user.mustChangePassword || !hasPermission(ctx.permissions, ["audit.view", "audit.export"]) || !ctx.organizationId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const q = new URL(req.url).searchParams;
  const filters: AuditFilters = {
    actor: q.get("actor") ?? undefined,
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
    module: q.get("module") ?? undefined,
    action: q.get("action") ?? undefined,
    entityId: q.get("entityId") ?? undefined,
    result: q.get("result") ?? undefined,
  };
  const settings = await getOrgSettings(ctx.organizationId);
  const where = auditWhere(ctx.organizationId, filters, settings?.timezone ?? "UTC");
  const rows = await db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: MAX_ROWS });
  await audit(ctx, { action: "audit.exported", module: "audit", metadata: { filters, rows: rows.length, truncated: rows.length === MAX_ROWS } });

  const header = ["createdAt", "actorName", "actorId", "action", "module", "entityType", "entityId", "propertyId", "result", "ip", "correlationId", "metadata", "before", "after"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.createdAt.toISOString(), r.actorName, r.actorId, r.action, r.module, r.entityType, r.entityId, r.propertyId,
      r.result, r.ip, r.correlationId, r.metadata, r.before, r.after,
    ].map(cell).join(","));
  }
  const name = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(`﻿${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
