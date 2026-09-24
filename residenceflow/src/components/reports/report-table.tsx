import type { T } from "@/i18n";
import { formatDay, formatMoney, formatNumber } from "@/lib/format";
import { Badge, Table, Td, Th, cn } from "@/components/ui";
import type { Cell, ColumnKind, ReportTable } from "@/services/reports";

/** Translates "rep.*" marker values; other strings are data and shown as-is. */
export function cellLabel(t: T, v: Cell): Cell {
  return typeof v === "string" && v.startsWith("rep.") ? t(v) : v;
}

export function formatCell(v: Cell, kind: ColumnKind | undefined, opts: { t: T; locale: string; currency: string; dateFormat: string }) {
  if (v === null || v === undefined || v === "") return "—";
  const label = cellLabel(opts.t, v);
  switch (kind) {
    case "money":
      return formatMoney(String(v), { locale: opts.locale, currency: opts.currency });
    case "number":
      return typeof v === "number" ? formatNumber(v, opts.locale) : String(label);
    case "percent":
      return typeof v === "number" ? `${formatNumber(v, opts.locale)} %` : String(label);
    case "day":
      return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? formatDay(String(v), { dateFormat: opts.dateFormat }) : String(label);
    default:
      return String(label);
  }
}

const RIGHT: ColumnKind[] = ["money", "number", "percent"];

export function ReportTableView({ table, t, locale, currency, dateFormat }: { table: ReportTable; t: T; locale: string; currency: string; dateFormat: string }) {
  const opts = { t, locale, currency, dateFormat };
  return (
    <div className="space-y-2">
      {table.title && <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t(table.title)}</h2>}
      <Table>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <Th key={c.key} className={cn(c.kind && RIGHT.includes(c.kind) && "text-right")}>{t(c.label)}</Th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {table.rows.length === 0 && (
            <tr><Td colSpan={table.columns.length} className="py-6 text-center text-slate-500">{t("rep.noData")}</Td></tr>
          )}
          {table.rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
              {table.columns.map((c) => (
                <Td key={c.key} className={cn(c.kind && RIGHT.includes(c.kind) && "whitespace-nowrap text-right tabular-nums")}>
                  {c.kind === "status" && r[c.key] ? <Badge status={String(r[c.key])} /> : formatCell(r[c.key] ?? null, c.kind, opts)}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
        {table.totals && table.rows.length > 0 && (
          <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold dark:border-slate-600 dark:bg-slate-800">
            <tr>
              {table.columns.map((c) => (
                <Td key={c.key} className={cn(c.kind && RIGHT.includes(c.kind) && "whitespace-nowrap text-right tabular-nums")}>
                  {table.totals![c.key] === undefined ? "" : c.kind === "status" ? String(cellLabel(t, table.totals![c.key] ?? "")) : formatCell(table.totals![c.key] ?? null, c.kind, opts)}
                </Td>
              ))}
            </tr>
          </tfoot>
        )}
      </Table>
    </div>
  );
}
