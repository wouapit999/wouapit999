import { describe, expect, it } from "vitest";
import { addMonthsClamped, applyPaymentsToInstallments, buildInstallments, planProgress } from "@/domain/payment-plan";
import { utcDate } from "@/domain/schedule";

describe("buildInstallments", () => {
  it("splits evenly and the last instalment absorbs rounding so the sum equals the total", () => {
    const rows = buildInstallments("100", 3, utcDate(2026, 0, 15), "MONTHLY");
    expect(rows.map((r) => r.amount.toFixed(2))).toEqual(["33.33", "33.33", "33.34"]);
    expect(rows.reduce((s, r) => s.plus(r.amount), rows[0].amount.minus(rows[0].amount)).toFixed(2)).toBe("100.00");
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3]);
  });

  it("handles rounding that goes the other way", () => {
    const rows = buildInstallments("200", 3, utcDate(2026, 0, 1), "MONTHLY");
    expect(rows.map((r) => r.amount.toFixed(2))).toEqual(["66.67", "66.67", "66.66"]);
  });

  it("generates monthly due dates clamped to month length", () => {
    const rows = buildInstallments("300000", 4, utcDate(2026, 0, 31), "MONTHLY");
    expect(rows.map((r) => r.dueDate.toISOString().slice(0, 10))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("generates weekly due dates", () => {
    const rows = buildInstallments("30", 3, utcDate(2026, 2, 30), "WEEKLY");
    expect(rows.map((r) => r.dueDate.toISOString().slice(0, 10))).toEqual(["2026-03-30", "2026-04-06", "2026-04-13"]);
  });

  it("rejects invalid input", () => {
    expect(() => buildInstallments("0", 2, utcDate(2026, 0, 1), "MONTHLY")).toThrow();
    expect(() => buildInstallments("10", 0, utcDate(2026, 0, 1), "MONTHLY")).toThrow();
  });
});

describe("addMonthsClamped", () => {
  it("keeps the day when possible", () => {
    expect(addMonthsClamped(utcDate(2026, 0, 15), 1).toISOString().slice(0, 10)).toBe("2026-02-15");
  });
  it("crosses years", () => {
    expect(addMonthsClamped(utcDate(2026, 10, 30), 3).toISOString().slice(0, 10)).toBe("2027-02-28");
  });
});

describe("applyPaymentsToInstallments", () => {
  const today = utcDate(2026, 3, 10);
  const plan = [
    { sequence: 2, dueDate: utcDate(2026, 3, 1), amount: "100" },
    { sequence: 1, dueDate: utcDate(2026, 2, 1), amount: "100" },
    { sequence: 3, dueDate: utcDate(2026, 4, 1), amount: "100" },
  ];

  it("applies sequentially, oldest first, with partials", () => {
    const r = applyPaymentsToInstallments(plan, "150", today);
    expect(r.map((x) => [x.sequence, x.paidAmount.toFixed(2), x.status])).toEqual([
      [1, "100.00", "PAID"],
      [2, "50.00", "OVERDUE"],
      [3, "0.00", "PENDING"],
    ]);
  });

  it("marks everything paid when the total is covered and never over-applies", () => {
    const r = applyPaymentsToInstallments(plan, "1000", today);
    expect(r.every((x) => x.status === "PAID")).toBe(true);
    expect(r.reduce((s, x) => s + Number(x.paidAmount), 0)).toBe(300);
  });

  it("flags unpaid instalments as OVERDUE only when past due", () => {
    const r = applyPaymentsToInstallments(plan, "0", today);
    expect(r.map((x) => x.status)).toEqual(["OVERDUE", "OVERDUE", "PENDING"]);
  });

  it("an instalment due today is still pending", () => {
    const r = applyPaymentsToInstallments([{ sequence: 1, dueDate: today, amount: "10" }], "0", today);
    expect(r[0].status).toBe("PENDING");
  });

  it("treats negative payments as zero and uses decimals", () => {
    const r = applyPaymentsToInstallments([{ sequence: 1, dueDate: utcDate(2027, 0, 1), amount: "0.3" }], "-5", today);
    expect(r[0].paidAmount.toFixed(2)).toBe("0.00");
    const r2 = applyPaymentsToInstallments(
      [{ sequence: 1, dueDate: utcDate(2027, 0, 1), amount: "0.1" }, { sequence: 2, dueDate: utcDate(2027, 0, 1), amount: "0.2" }],
      "0.3",
      today,
    );
    expect(r2.map((x) => x.status)).toEqual(["PAID", "PAID"]);
  });
});

describe("planProgress", () => {
  it("computes totals and completion", () => {
    const p = planProgress([{ amount: "100", paidAmount: "100" }, { amount: "50", paidAmount: "25" }]);
    expect(p.total.toFixed(2)).toBe("150.00");
    expect(p.remaining.toFixed(2)).toBe("25.00");
    expect(p.percent).toBe(83);
    expect(p.complete).toBe(false);
    expect(planProgress([{ amount: "10", paidAmount: "10" }]).complete).toBe(true);
  });
});
