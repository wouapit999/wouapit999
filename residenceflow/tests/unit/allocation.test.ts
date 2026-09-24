import { describe, expect, it } from "vitest";
import { allocatePayment, deriveInvoiceStatus, validateManualAllocation } from "@/domain/allocation";
import { utcDate } from "@/domain/schedule";

const invoices = [
  { id: "b", dueDate: utcDate(2026, 1, 5), balance: "100000" },
  { id: "a", dueDate: utcDate(2026, 0, 5), balance: "100000" },
  { id: "c", dueDate: utcDate(2026, 2, 5), balance: "100000" },
];

describe("allocatePayment", () => {
  it("settles the oldest invoice first and supports partial payments", () => {
    const r = allocatePayment("150000", invoices);
    expect(r.lines.map((l) => [l.invoiceId, l.amount.toFixed(2)])).toEqual([
      ["a", "100000.00"],
      ["b", "50000.00"],
    ]);
    expect(r.unapplied.toFixed(2)).toBe("0.00");
  });

  it("keeps overpayments as unapplied credit", () => {
    const r = allocatePayment("350000", invoices);
    expect(r.lines).toHaveLength(3);
    expect(r.unapplied.toFixed(2)).toBe("50000.00");
  });

  it("never allocates more than the payment", () => {
    const r = allocatePayment("0.01", invoices);
    const total = r.lines.reduce((s, l) => s + Number(l.amount), 0);
    expect(total).toBeCloseTo(0.01);
  });

  it("uses decimals, not floats", () => {
    const r = allocatePayment("0.3", [
      { id: "x", dueDate: utcDate(2026, 0, 1), balance: "0.1" },
      { id: "y", dueDate: utcDate(2026, 0, 2), balance: "0.2" },
    ]);
    expect(r.unapplied.toFixed(2)).toBe("0.00");
  });

  it("supports newest-first strategy", () => {
    const r = allocatePayment("100000", invoices, "NEWEST_FIRST");
    expect(r.lines[0].invoiceId).toBe("c");
  });
});

describe("validateManualAllocation", () => {
  it("rejects allocations exceeding the payment", () => {
    expect(validateManualAllocation("100", [{ invoiceId: "a", amount: "60" }, { invoiceId: "b", amount: "60" }], { a: "100", b: "100" }))
      .toMatch(/exceed the payment/);
  });
  it("rejects allocations exceeding an invoice balance", () => {
    expect(validateManualAllocation("500", [{ invoiceId: "a", amount: "150" }], { a: "100" })).toMatch(/invoice balance/);
  });
  it("accepts valid allocations", () => {
    expect(validateManualAllocation("100", [{ invoiceId: "a", amount: "100" }], { a: "100" })).toBeNull();
  });
});

describe("deriveInvoiceStatus", () => {
  const today = utcDate(2026, 5, 10);
  it("paid", () => expect(deriveInvoiceStatus("100", "100", "0", utcDate(2026, 5, 1), today)).toBe("PAID"));
  it("overdue", () => expect(deriveInvoiceStatus("100", "50", "0", utcDate(2026, 5, 1), today)).toBe("OVERDUE"));
  it("partial", () => expect(deriveInvoiceStatus("100", "50", "0", utcDate(2026, 5, 20), today)).toBe("PARTIALLY_PAID"));
  it("issued", () => expect(deriveInvoiceStatus("100", "0", "0", utcDate(2026, 5, 20), today)).toBe("ISSUED"));
  it("credit counts toward settlement", () => expect(deriveInvoiceStatus("100", "60", "40", utcDate(2026, 5, 1), today)).toBe("PAID"));
});
