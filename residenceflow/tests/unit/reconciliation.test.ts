import { describe, expect, it } from "vitest";
import { autoMatch, matchedTotal, parseStatementCsv, statementTotal, type CandidatePayment } from "@/domain/reconciliation";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const payments: CandidatePayment[] = [
  { id: "p1", reference: "PAY-000001", externalRef: "MOMO123", amount: "50000.00", paymentDate: d("2026-03-02") },
  { id: "p2", reference: "PAY-000002", externalRef: null, amount: "75000.00", paymentDate: d("2026-03-05") },
  { id: "p3", reference: "PAY-000003", externalRef: null, amount: "75000.00", paymentDate: d("2026-03-06") },
  { id: "p4", reference: "PAY-000004", externalRef: null, amount: "20000.00", paymentDate: d("2026-03-20") },
];

describe("parseStatementCsv", () => {
  it("parses comma and semicolon separated lines, skipping the header", () => {
    const { lines, errors } = parseStatementCsv('date,reference,amount,description\n2026-03-02,MOMO123,50000,Rent\n2026-03-05;X;"1 234,50";Fees; extra');
    expect(errors).toEqual([]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ date: "2026-03-02", reference: "MOMO123", amount: "50000.00", description: "Rent", matched: false });
    expect(lines[1].amount).toBe("1234.50");
    expect(lines[1].description).toBe("Fees; extra");
  });
  it("reports invalid rows with line numbers", () => {
    const { lines, errors } = parseStatementCsv("2026-13-40,x,10\nbad line\n2026-03-02,ok,abc\n2026-03-02,ok,10");
    expect(lines).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([1, 2, 3]);
  });
});

describe("autoMatch", () => {
  it("matches by external reference or payment reference first", () => {
    const { lines } = autoMatch(
      [
        { date: "2026-03-10", reference: "momo123", amount: "1.00", description: "", matched: false },
        { date: "2026-03-10", reference: "pay-000004", amount: "1.00", description: "", matched: false },
      ],
      payments,
    );
    expect(lines[0]).toMatchObject({ paymentId: "p1", matched: true, matchType: "reference" });
    expect(lines[1]).toMatchObject({ paymentId: "p4", matched: true, matchType: "reference" });
  });
  it("matches by amount within ±3 days only when exactly one candidate", () => {
    const r = autoMatch(
      [
        { date: "2026-03-22", reference: "", amount: "20000.00", description: "", matched: false }, // p4, 2 days
        { date: "2026-03-05", reference: "", amount: "75000.00", description: "", matched: false }, // p2 and p3 both within window → ambiguous
        { date: "2026-03-30", reference: "", amount: "20000.00", description: "", matched: false }, // too far
      ],
      payments,
    );
    expect(r.lines[0]).toMatchObject({ paymentId: "p4", matched: true, matchType: "amount" });
    expect(r.lines[1]).toMatchObject({ paymentId: null, matched: false });
    expect(r.lines[2].matched).toBe(false);
    expect(r.matchedCount).toBe(1);
    expect(r.unmatchedCount).toBe(2);
  });
  it("never uses the same payment twice and keeps existing matches", () => {
    const r = autoMatch(
      [
        { date: "2026-03-02", reference: "", amount: "50000.00", description: "", matched: true, paymentId: "p1", matchType: "manual" },
        { date: "2026-03-02", reference: "MOMO123", amount: "50000.00", description: "", matched: false },
      ],
      payments,
    );
    expect(r.lines[0].paymentId).toBe("p1");
    expect(r.lines[1].matched).toBe(false);
  });
});

describe("totals", () => {
  it("sums statement and matched totals", () => {
    const lines = [
      { date: "2026-03-01", reference: "", amount: "10.50", description: "", matched: true, paymentId: "x" },
      { date: "2026-03-01", reference: "", amount: "4.50", description: "", matched: false },
    ];
    expect(statementTotal(lines).toFixed(2)).toBe("15.00");
    expect(matchedTotal(lines).toFixed(2)).toBe("10.50");
  });
});
