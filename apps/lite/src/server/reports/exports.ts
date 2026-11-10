import ExcelJS from 'exceljs';
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';

/**
 * Export builders (phase 10): one tabular model, three formats — CSV, Excel (exceljs) and PDF
 * (pdf-lib). Pure functions: they take a `ReportTable` and return bytes.
 */

export type ReportCell = string | number | bigint | null;

export interface ReportColumn {
  readonly key: string;
  readonly label: string;
  readonly align?: 'left' | 'right';
  /** Relative width for PDF / Excel (default 1). */
  readonly width?: number;
}

export interface ReportTable {
  readonly title: string;
  readonly subtitle?: string;
  readonly columns: readonly ReportColumn[];
  readonly rows: ReadonlyArray<Readonly<Record<string, ReportCell>>>;
  readonly generatedAt: Date;
}

export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportedFile {
  readonly data: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
}

const cellText = (value: ReportCell | undefined): string =>
  value === null || value === undefined ? '' : typeof value === 'string' ? value : value.toString();

/**
 * CSV cell: quoted when needed, and neutralised against spreadsheet formula injection — text
 * starting with `=`, `+`, `-`, `@`, tab or CR gets a leading apostrophe (numbers are left alone).
 */
export function csvCell(value: ReportCell | undefined): string {
  let text = cellText(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(table: ReportTable): Uint8Array {
  const lines = [
    table.columns.map((column) => csvCell(column.label)).join(','),
    ...table.rows.map((row) => table.columns.map((column) => csvCell(row[column.key])).join(',')),
  ];
  // BOM so Excel opens UTF-8 correctly.
  return new TextEncoder().encode(`\ufeff${lines.join('\r\n')}\r\n`);
}

export async function toXlsx(table: ReportTable): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BI-Rem Lite';
  workbook.created = table.generatedAt;
  const sheet = workbook.addWorksheet(table.title.slice(0, 31).replace(/[\\/*?:[\]]/g, ' '), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = table.columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: Math.round(16 * (column.width ?? 1)),
    style: { alignment: { horizontal: column.align ?? 'left' } },
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of table.rows) {
    sheet.addRow(
      Object.fromEntries(
        table.columns.map((column) => {
          const value = row[column.key];
          if (typeof value === 'bigint') {
            // Keep exactness: only values that fit a double become numbers.
            return [
              column.key,
              value <= 9_007_199_254_740_991n && value >= -9_007_199_254_740_991n
                ? Number(value)
                : value.toString(),
            ];
          }
          if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value))
            return [column.key, `'${value}`];
          return [column.key, value ?? ''];
        }),
      ),
    );
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

/**
 * The standard PDF fonts only cover WinAnsi (Latin-1 and a few extras). Anything else is mapped
 * to a close ASCII equivalent or `?` so `drawText` never throws on names or currency symbols.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/[\u202f\u00a0\u2009]/g, ' ')
    .replace(/→/g, '->')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7e¡-ÿ]/g, '?');
}

function fitText(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const safe = pdfSafe(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let cut = safe;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > maxWidth)
    cut = cut.slice(0, -1);
  return `${cut}...`;
}

const BRAND = rgb(0.043, 0.431, 0.31);
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const RULE = rgb(0.89, 0.91, 0.94);

export async function toPdf(table: ReportTable): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(table.title));
  pdf.setCreator('BI-Rem Lite');
  pdf.setCreationDate(table.generatedAt);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // A4 landscape.
  const width = 841.89;
  const height = 595.28;
  const margin = 36;
  const fontSize = 8;
  const rowHeight = 16;
  const usable = width - margin * 2;
  const totalWeight = table.columns.reduce((total, column) => total + (column.width ?? 1), 0);
  const widths = table.columns.map((column) => (usable * (column.width ?? 1)) / totalWeight);

  let page: PDFPage = pdf.addPage([width, height]);
  let y = height - margin;
  let pageNumber = 1;

  const drawRow = (cells: readonly string[], font: PDFFont, color = INK): void => {
    let x = margin;
    cells.forEach((cell, index) => {
      const column = table.columns[index];
      const columnWidth = widths[index] ?? 0;
      const text = fitText(font, cell, fontSize, columnWidth - 6);
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      page.drawText(text, {
        x: column?.align === 'right' ? x + columnWidth - 3 - textWidth : x + 3,
        y: y - 11,
        size: fontSize,
        font,
        color,
      });
      x += columnWidth;
    });
    y -= rowHeight;
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.5,
      color: RULE,
    });
  };

  const drawFooter = (): void => {
    page.drawText(pdfSafe(`BI-Rem Lite - ${table.title} - page ${pageNumber}`), {
      x: margin,
      y: 18,
      size: 7,
      font: regular,
      color: MUTED,
    });
  };

  const drawHeader = (): void => {
    page.drawText(pdfSafe(table.title), {
      x: margin,
      y: y - 14,
      size: 14,
      font: bold,
      color: BRAND,
    });
    y -= 22;
    const subtitle = `${table.subtitle ? `${table.subtitle} - ` : ''}generated ${table.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC - ${table.rows.length} row(s)`;
    page.drawText(pdfSafe(subtitle), { x: margin, y: y - 9, size: 8, font: regular, color: MUTED });
    y -= 20;
    drawRow(
      table.columns.map((column) => column.label),
      bold,
      BRAND,
    );
  };

  drawHeader();
  for (const row of table.rows) {
    if (y - rowHeight < margin + 10) {
      drawFooter();
      page = pdf.addPage([width, height]);
      pageNumber += 1;
      y = height - margin;
      drawHeader();
    }
    drawRow(
      table.columns.map((column) => cellText(row[column.key])),
      regular,
    );
  }
  if (table.rows.length === 0) {
    page.drawText('No data for this period.', {
      x: margin + 3,
      y: y - 14,
      size: 9,
      font: regular,
      color: MUTED,
    });
  }
  drawFooter();
  return pdf.save();
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export const isExportFormat = (value: string): value is ExportFormat =>
  (EXPORT_FORMATS as readonly string[]).includes(value);

/** Renders a table in the requested format with a safe, dated file name. */
export async function exportTable(table: ReportTable, format: ExportFormat): Promise<ExportedFile> {
  const slug =
    table.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'report';
  const data =
    format === 'csv' ? toCsv(table) : format === 'xlsx' ? await toXlsx(table) : await toPdf(table);
  return {
    data,
    contentType: CONTENT_TYPES[format],
    fileName: `bi-rem-${slug}-${table.generatedAt.toISOString().slice(0, 10)}.${format}`,
  };
}
