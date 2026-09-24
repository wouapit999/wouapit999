import Decimal from "decimal.js";

export interface StatementLine {
  date: string; // yyyy-mm-dd
  reference: string;
  amount: string; // 2 dp string
  description: string;
  paymentId?: string | null;
  matched: boolean;
  /** How the match was made: "reference" | "amount" | "manual". */
  matchType?: string | null;
}

export interface CandidatePayment {
  id: string;
  reference: string;
  externalRef: string | null;
  amount: string | { toString(): string };
  paymentDate: Date;
}

export interface ParseError {
  line: number;
  error: string;
}

const DAY = 86_400_000;
const normRef = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function toDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Strict yyyy-mm-dd check (Date.UTC would silently roll 2026-13-40 over). */
export function isValidDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Parses `date,reference,amount,description` (also `;`). Header row optional. Amount accepts "1 234,50" or "1234.50". */
export function parseStatementCsv(text: string): { lines: StatementLine[]; errors: ParseError[] } {
  const lines: StatementLine[] = [];
  const errors: ParseError[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const sep = trimmed.includes(";") ? ";" : ",";
    const parts = trimmed.split(sep).map((p) => p.trim().replace(/^"|"$/g, ""));
    if (i === 0 && /^date$/i.test(parts[0] ?? "")) return;
    if (parts.length < 3) return void errors.push({ line: n, error: "Expected date,reference,amount[,description]" });
    const [date, reference, amountRaw, ...rest] = parts;
    if (!isValidDay(date)) return void errors.push({ line: n, error: "Invalid date (yyyy-mm-dd)" });
    const normalized = amountRaw.replace(/\s/g, "").replace(/,(\d{1,2})$/, ".$1").replace(/,/g, "");
    if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return void errors.push({ line: n, error: "Invalid amount" });
    lines.push({ date, reference, amount: new Decimal(normalized).toFixed(2), description: rest.join(sep === ";" ? "; " : ", "), paymentId: null, matched: false, matchType: null });
  });
  return { lines, errors };
}

/**
 * Auto-matches statement lines against internal payments.
 * 1. Exact match on externalRef or payment reference (case-insensitive).
 * 2. Otherwise same amount and paymentDate within ±windowDays, only when exactly one candidate.
 * Each payment is used at most once.
 */
export function autoMatch(lines: StatementLine[], payments: CandidatePayment[], windowDays = 3): { lines: StatementLine[]; matchedCount: number; unmatchedCount: number } {
  const used = new Set<string>();
  for (const l of lines) if (l.matched && l.paymentId) used.add(l.paymentId);
  const out = lines.map((line) => {
    if (line.matched && line.paymentId) return line;
    const ref = normRef(line.reference);
    if (ref) {
      const byRef = payments.find((p) => !used.has(p.id) && (normRef(p.externalRef) === ref || normRef(p.reference) === ref));
      if (byRef) {
        used.add(byRef.id);
        return { ...line, paymentId: byRef.id, matched: true, matchType: "reference" };
      }
    }
    const amt = new Decimal(line.amount);
    const day = toDay(line.date).getTime();
    const candidates = payments.filter((p) => {
      if (used.has(p.id)) return false;
      if (!new Decimal(p.amount.toString()).eq(amt)) return false;
      const diff = Math.abs(p.paymentDate.getTime() - day);
      return diff <= windowDays * DAY;
    });
    if (candidates.length === 1) {
      used.add(candidates[0].id);
      return { ...line, paymentId: candidates[0].id, matched: true, matchType: "amount" };
    }
    return { ...line, paymentId: null, matched: false, matchType: null };
  });
  const matchedCount = out.filter((l) => l.matched).length;
  return { lines: out, matchedCount, unmatchedCount: out.length - matchedCount };
}

export function statementTotal(lines: StatementLine[]): Decimal {
  return lines.reduce((s, l) => s.plus(new Decimal(l.amount)), new Decimal(0));
}

export function matchedTotal(lines: StatementLine[]): Decimal {
  return lines.filter((l) => l.matched).reduce((s, l) => s.plus(new Decimal(l.amount)), new Decimal(0));
}

/** Coerces stored JSON into typed lines (defensive against malformed rows). */
export function coerceLines(json: unknown): StatementLine[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      date: String(x.date ?? ""),
      reference: String(x.reference ?? ""),
      amount: String(x.amount ?? "0"),
      description: String(x.description ?? ""),
      paymentId: typeof x.paymentId === "string" ? x.paymentId : null,
      matched: x.matched === true,
      matchType: typeof x.matchType === "string" ? x.matchType : null,
    }));
}
