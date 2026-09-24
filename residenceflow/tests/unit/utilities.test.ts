import { describe, expect, it } from "vitest";
import { computeConsumption, computeUtilityAmount, parseReadingCsv } from "@/domain/utilities";

describe("computeConsumption", () => {
  it("subtracts the previous reading", () => {
    expect(computeConsumption("120.5", "150.25").toFixed(3)).toBe("29.750");
  });
  it("treats a missing previous reading as zero", () => {
    expect(computeConsumption(null, "42").toFixed(3)).toBe("42.000");
  });
  it("rejects a reading below the previous one", () => {
    expect(() => computeConsumption("100", "99.999")).toThrow();
  });
  it("accepts equal readings (zero consumption)", () => {
    expect(computeConsumption("100", "100").isZero()).toBe(true);
  });
});

describe("computeUtilityAmount", () => {
  it("multiplies by the tariff and adds the fixed fee", () => {
    expect(computeUtilityAmount("29.75", "79.5", "1500").toFixed(2)).toBe("3865.13");
  });
  it("rounds half up to 2 dp", () => {
    expect(computeUtilityAmount("1", "0.005", 0).toFixed(2)).toBe("0.01");
  });
  it("never returns a negative amount", () => {
    expect(computeUtilityAmount("10", "-5", 0).toFixed(2)).toBe("0.00");
  });
});

describe("parseReadingCsv", () => {
  it("parses rows, skips a header and blank lines, accepts semicolons", () => {
    const { rows, errors } = parseReadingCsv("serial,date,value\nM-1,2026-01-31,120.5\n\nM-2;2026-01-31;300");
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, serial: "M-1", date: "2026-01-31", value: "120.5" },
      { line: 4, serial: "M-2", date: "2026-01-31", value: "300" },
    ]);
  });
  it("reports per-row errors with line numbers", () => {
    const { rows, errors } = parseReadingCsv("M-1,31/01/2026,10\nM-1,2026-01-31,abc\nonly-one\nM-1,2026-01-31,10");
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([1, 2, 3]);
  });
});
