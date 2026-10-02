import { describe, expect, it } from "vitest";
import { generateSchedule, utcDate } from "@/domain/schedule";

describe("generateSchedule", () => {
  it("creates 12 full monthly periods for a calendar-year lease", () => {
    const p = generateSchedule({
      startDate: utcDate(2026, 0, 1), endDate: utcDate(2026, 11, 31),
      frequency: "MONTHLY", amount: "150000", dueDay: 5, prorate: true,
    });
    expect(p).toHaveLength(12);
    expect(p.every((x) => x.amount.toFixed(2) === "150000.00")).toBe(true);
    expect(p[0].dueDate.toISOString().slice(0, 10)).toBe("2026-01-05");
    expect(p[11].periodEnd.toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("prorates the first and last partial months by day count", () => {
    const p = generateSchedule({
      startDate: utcDate(2026, 3, 16), endDate: utcDate(2026, 5, 15),
      frequency: "MONTHLY", amount: "30000", dueDay: 1, prorate: true,
    });
    expect(p).toHaveLength(3);
    // April: 15 of 30 days
    expect(p[0].amount.toFixed(2)).toBe("15000.00");
    expect(p[0].prorated).toBe(true);
    // first partial period due on move-in, not before it
    expect(p[0].dueDate.toISOString().slice(0, 10)).toBe("2026-04-16");
    expect(p[1].amount.toFixed(2)).toBe("30000.00");
    // June: 15 of 30 days
    expect(p[2].amount.toFixed(2)).toBe("15000.00");
  });

  it("does not prorate when disabled", () => {
    const p = generateSchedule({
      startDate: utcDate(2026, 3, 16), endDate: utcDate(2026, 4, 31),
      frequency: "MONTHLY", amount: "30000", dueDay: 1, prorate: false,
    });
    expect(p[0].amount.toFixed(2)).toBe("30000.00");
  });

  it("clamps the due day to the month length", () => {
    const p = generateSchedule({
      startDate: utcDate(2026, 1, 1), endDate: utcDate(2026, 1, 28),
      frequency: "MONTHLY", amount: "1000", dueDay: 31, prorate: true,
    });
    expect(p[0].dueDate.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("supports quarterly and annual frequencies", () => {
    const q = generateSchedule({
      startDate: utcDate(2026, 0, 1), endDate: utcDate(2026, 11, 31),
      frequency: "QUARTERLY", amount: "300000", dueDay: 1, prorate: true,
    });
    expect(q).toHaveLength(4);
    const a = generateSchedule({
      startDate: utcDate(2026, 0, 1), endDate: utcDate(2027, 11, 31),
      frequency: "ANNUAL", amount: "1200000", dueDay: 1, prorate: true,
    });
    expect(a).toHaveLength(2);
  });

  it("generates weekly periods with a prorated tail", () => {
    const w = generateSchedule({
      startDate: utcDate(2026, 0, 1), endDate: utcDate(2026, 0, 10),
      frequency: "WEEKLY", amount: "7000", dueDay: 1, prorate: true,
    });
    expect(w).toHaveLength(2);
    expect(w[1].amount.toFixed(2)).toBe("3000.00");
  });

  it("returns nothing for an inverted range", () => {
    expect(generateSchedule({
      startDate: utcDate(2026, 5, 1), endDate: utcDate(2026, 0, 1),
      frequency: "MONTHLY", amount: "1", dueDay: 1, prorate: true,
    })).toEqual([]);
  });
});
