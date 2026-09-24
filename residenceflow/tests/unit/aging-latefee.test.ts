import { describe, expect, it } from "vitest";
import { ageBalances, bucketFor } from "@/domain/aging";
import { computeLateFee } from "@/domain/late-fee";
import { utcDate } from "@/domain/schedule";

const today = utcDate(2026, 5, 30);

describe("aging", () => {
  it("assigns buckets at the boundaries", () => {
    expect(bucketFor(utcDate(2026, 5, 30), today)).toBe("current");
    expect(bucketFor(utcDate(2026, 5, 29), today)).toBe("d1_30");
    expect(bucketFor(utcDate(2026, 4, 31), today)).toBe("d1_30"); // 30 days
    expect(bucketFor(utcDate(2026, 4, 30), today)).toBe("d31_60");
    expect(bucketFor(utcDate(2026, 3, 1), today)).toBe("d61_90");
    expect(bucketFor(utcDate(2026, 0, 1), today)).toBe("d90_plus");
  });
  it("sums balances per bucket and ignores settled items", () => {
    const r = ageBalances([
      { dueDate: utcDate(2026, 5, 20), balance: "100" },
      { dueDate: utcDate(2026, 0, 1), balance: "50.50" },
      { dueDate: utcDate(2026, 0, 1), balance: "0" },
    ], today);
    expect(r.d1_30.toFixed(2)).toBe("100.00");
    expect(r.d90_plus.toFixed(2)).toBe("50.50");
    expect(r.total.toFixed(2)).toBe("150.50");
  });
});

describe("late fees", () => {
  const base = { outstanding: "100000", dueDate: utcDate(2026, 5, 1), graceDays: 5, today };
  it("respects the grace period", () => {
    expect(computeLateFee({ ...base, type: "FIXED", value: "5000", today: utcDate(2026, 5, 6) })).toBeNull();
    expect(computeLateFee({ ...base, type: "FIXED", value: "5000", today: utcDate(2026, 5, 7) })?.toFixed(2)).toBe("5000.00");
  });
  it("computes percentage fees on the outstanding balance", () => {
    expect(computeLateFee({ ...base, type: "PERCENT", value: "2.5" })?.toFixed(2)).toBe("2500.00");
  });
  it("charges nothing when disabled or settled", () => {
    expect(computeLateFee({ ...base, type: "NONE", value: "5" })).toBeNull();
    expect(computeLateFee({ ...base, outstanding: "0", type: "FIXED", value: "5" })).toBeNull();
  });
});
