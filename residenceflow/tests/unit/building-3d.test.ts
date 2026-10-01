import { describe, expect, it } from "vitest";
import { buildModel, footprint, layoutRooms, type UnitInput } from "@/domain/building-3d";

const unit = (over: Partial<UnitInput>): UnitInput => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  number: "1A", block: "", floor: 1, type: "APARTMENT", bedrooms: 2, bathrooms: 1, area: 70, status: "VACANT", ...over,
});

describe("footprint", () => {
  it("scales with area and falls back per type", () => {
    const small = footprint(35, "STUDIO");
    const big = footprint(140, "APARTMENT");
    expect(big.w * big.d).toBeGreaterThan(small.w * small.d);
    expect(footprint(null, "SHOP").w * footprint(null, "SHOP").d).toBeCloseTo(50, 0);
  });
});

describe("layoutRooms", () => {
  it("creates living, kitchen, bedrooms and bathrooms that fit inside the footprint", () => {
    const { w, d } = footprint(95, "APARTMENT");
    const rooms = layoutRooms({ type: "APARTMENT", bedrooms: 3, bathrooms: 2 }, w, d);
    expect(rooms.filter((r) => r.key === "BEDROOM")).toHaveLength(3);
    expect(rooms.filter((r) => r.key === "BATHROOM")).toHaveLength(2);
    expect(rooms.some((r) => r.key === "LIVING")).toBe(true);
    expect(rooms.some((r) => r.key === "KITCHEN")).toBe(true);
    for (const r of rooms.filter((r) => r.key !== "BALCONY")) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(w + 0.5);
      expect(r.z + r.d).toBeLessThanOrEqual(d + 0.01);
    }
  });
  it("handles studios and shops", () => {
    expect(layoutRooms({ type: "STUDIO", bedrooms: 0, bathrooms: 1 }, 6, 6).map((r) => r.key)).toEqual(["STUDIO", "BATHROOM"]);
    expect(layoutRooms({ type: "SHOP", bedrooms: 0, bathrooms: 0 }, 8, 6)).toHaveLength(1);
  });
});

describe("buildModel", () => {
  it("places every unit on its floor and block without overlaps", () => {
    const units = [
      unit({ id: "a", number: "1A", floor: 1 }), unit({ id: "b", number: "1B", floor: 1 }),
      unit({ id: "c", number: "2A", floor: 2 }), unit({ id: "d", number: "G1", floor: 0, block: "B", type: "SHOP", bedrooms: 0 }),
    ];
    const m = buildModel({ floors: 3, blocks: 2 }, units);
    expect(m.floors).toEqual([0, 1, 2]);
    expect(m.blocks).toEqual(["", "B"]);
    expect(m.units).toHaveLength(4);
    const a = m.units.find((u) => u.id === "a")!;
    const b = m.units.find((u) => u.id === "b")!;
    expect(a.y).toBeCloseTo(1 * m.floorHeight + 0.25, 2);
    expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual((a.w + b.w) / 2); // side by side, no overlap
    expect(m.slabs.filter((s) => s.block === "")).toHaveLength(3);
    expect(m.bounds.h).toBeCloseTo(3 * m.floorHeight, 2);
    const shop = m.units.find((u) => u.id === "d")!;
    expect(shop.z).toBeGreaterThan(a.z); // second block behind the first
  });
  it("works for a building without units yet", () => {
    const m = buildModel({ floors: 2, blocks: 1 }, []);
    expect(m.units).toEqual([]);
    expect(m.slabs).toHaveLength(2);
  });
});
