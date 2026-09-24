import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { BusinessError, ForbiddenError } from "@/lib/errors";
import { getT } from "@/i18n";
import { canViewReport, getReport, iso, parseReportParams, toCsv } from "@/services/reports";
import { reportMessages } from "@/app/(app)/reports/i18n";
import { assertNotSupportAccess } from "@/services/support-access";

/**
 * CSV export of a report. Requires report.export plus the report's own view permission;
 * uses the same scoped service function as the page, and every export is audited.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const def = getReport(key);
  if (!def) return NextResponse.json({ error: "not_found" }, { status: 404 });
  let ctx;
  try {
    ctx = await authorize("report.export");
    if (!canViewReport(ctx, def)) throw new ForbiddenError();
    assertNotSupportAccess(ctx); // exports are blocked while acting under platform support access
  } catch (e) {
    if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof ForbiddenError) {
      const status = e.message === "unauthenticated" ? 401 : 403;
      return NextResponse.json({ error: status === 401 ? "unauthenticated" : "forbidden" }, { status });
    }
    throw e;
  }
  const sp = new URL(req.url).searchParams;
  const p = parseReportParams(key, sp);
  const result = await def.run(ctx, p);
  const { t } = await getT(reportMessages);
  // "rep.*" marker values (e.g. the totals label) are translated; data cells are exported as-is.
  const csv = toCsv(result, (k) => t(k), (c) => (typeof c === "string" && c.startsWith("rep.") ? t(c) : c));
  await audit(ctx, {
    action: "report.exported",
    module: "reports",
    entityType: "Report",
    entityId: key,
    propertyId: p.propertyId || null,
    metadata: { key, propertyId: p.propertyId || null, from: iso(p.from), to: iso(p.to), date: iso(p.date), days: p.days, month: p.month, rows: result.tables.reduce((a, x) => a + x.rows.length, 0) },
  });
  const filename = `${key}-${iso(new Date())}.csv`;
  // UTF-8 BOM so spreadsheet apps detect accents correctly.
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
