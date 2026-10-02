/**
 * Procedural 3D layout of a building from its data model (pure, no I/O).
 * Units are arranged per block and floor; each unit gets a footprint proportional to its area
 * and an interior split into rooms derived from its bedroom/bathroom counts.
 * Units: metres. X = along the façade, Y = up, Z = depth (blocks are stacked along Z).
 */

export interface UnitInput {
  id: string;
  number: string;
  block: string;
  floor: number;
  type: string;
  bedrooms: number;
  bathrooms: number;
  area: number | null;
  status: string;
  tenantName?: string | null;
  rent?: string | null;
}

export interface Room {
  key: string; // LIVING | KITCHEN | BEDROOM | BATHROOM | BALCONY | SHOP | OFFICE | STUDIO
  label: string;
  x: number; // offset inside the unit footprint
  z: number;
  w: number;
  d: number;
}

export interface UnitBox {
  id: string;
  number: string;
  block: string;
  floor: number;
  type: string;
  bedrooms: number;
  bathrooms: number;
  area: number | null;
  status: string;
  tenantName: string | null;
  rent: string | null;
  x: number; // centre
  y: number; // base (floor level)
  z: number; // centre
  w: number;
  h: number;
  d: number;
  rooms: Room[];
}

export interface FloorSlab {
  block: string;
  floor: number;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
}

export interface BuildingModel {
  blocks: string[];
  floors: number[]; // ascending (0 = ground)
  units: UnitBox[];
  slabs: FloorSlab[];
  cores: { block: string; x: number; z: number; w: number; d: number; h: number }[];
  bounds: { w: number; h: number; d: number };
  floorHeight: number;
}

export const FLOOR_HEIGHT = 3.2;
const SLAB = 0.25;
const GAP = 0.6; // between units
const CORE_W = 3; // stairwell / lift core per floor
const BLOCK_GAP = 8;
const DEFAULT_AREA: Record<string, number> = { STUDIO: 35, APARTMENT: 75, SHOP: 50, OFFICE: 60, HOUSE: 120, ROOM: 20 };

export function footprint(area: number | null, type: string) {
  const a = area && area > 8 ? area : DEFAULT_AREA[type] ?? 70;
  // Depth fixed-ish around 9 m so façades stay readable; width carries the area.
  const d = Math.min(12, Math.max(6, Math.sqrt(a) * 1.05));
  const w = Math.max(3.5, a / d);
  return { w: round(w), d: round(d) };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/** Splits a unit footprint into labelled rooms (front row: living/kitchen; back row: bedrooms/baths). */
export function layoutRooms(u: Pick<UnitInput, "type" | "bedrooms" | "bathrooms">, w: number, d: number): Room[] {
  if (u.type === "SHOP") return [{ key: "SHOP", label: "shop", x: 0, z: 0, w, d }];
  if (u.type === "OFFICE") return [{ key: "OFFICE", label: "office", x: 0, z: 0, w, d }];
  if (u.type === "ROOM") return [{ key: "STUDIO", label: "room", x: 0, z: 0, w, d }];
  const rooms: Room[] = [];
  const frontD = round(d * 0.5);
  const backD = round(d - frontD);
  if (u.type === "STUDIO" || u.bedrooms === 0) {
    const bathW = round(Math.min(2.2, w * 0.3));
    rooms.push({ key: "STUDIO", label: "studio", x: 0, z: 0, w: round(w - bathW), d });
    rooms.push({ key: "BATHROOM", label: "bathroom", x: round(w - bathW), z: 0, w: bathW, d });
    return rooms;
  }
  // Front row: living (2/3) + kitchen (1/3); balcony strip when wide enough.
  const kitchenW = round(w / 3);
  rooms.push({ key: "LIVING", label: "living", x: 0, z: 0, w: round(w - kitchenW), d: frontD });
  rooms.push({ key: "KITCHEN", label: "kitchen", x: round(w - kitchenW), z: 0, w: kitchenW, d: frontD });
  // Back row: bedrooms and bathrooms share the width.
  const cells = Math.max(1, u.bedrooms) + Math.max(1, u.bathrooms);
  const bedW = round((w / cells) * 1.3);
  const bathW = round((w - bedW * Math.max(1, u.bedrooms)) / Math.max(1, u.bathrooms));
  let x = 0;
  for (let i = 0; i < Math.max(1, u.bedrooms); i++) {
    rooms.push({ key: "BEDROOM", label: `bedroom ${i + 1}`, x: round(x), z: frontD, w: bedW, d: backD });
    x += bedW;
  }
  for (let i = 0; i < Math.max(1, u.bathrooms); i++) {
    rooms.push({ key: "BATHROOM", label: `bathroom ${i + 1}`, x: round(x), z: frontD, w: Math.max(1.2, bathW), d: backD });
    x += bathW;
  }
  if (w >= 8) rooms.push({ key: "BALCONY", label: "balcony", x: 0, z: round(-1.2), w: round(w * 0.5), d: 1.2 });
  return rooms;
}

export function buildModel(input: { floors: number; blocks: number }, units: UnitInput[]): BuildingModel {
  const blockNames = [...new Set(units.map((u) => u.block || ""))].sort();
  if (blockNames.length === 0) blockNames.push("");
  const floorSet = new Set<number>(units.map((u) => u.floor));
  for (let f = 0; f < Math.max(1, input.floors); f++) floorSet.add(f);
  const floors = [...floorSet].sort((a, b) => a - b);

  const boxes: UnitBox[] = [];
  const slabs: FloorSlab[] = [];
  const cores: BuildingModel["cores"] = [];
  let zCursor = 0;
  let maxW = 0;
  let maxD = 0;

  for (const block of blockNames) {
    const blockUnits = units.filter((u) => (u.block || "") === block);
    // Width of the block = widest floor row.
    const rows = new Map<number, UnitInput[]>();
    for (const u of blockUnits) rows.set(u.floor, [...(rows.get(u.floor) ?? []), u]);
    let blockW = CORE_W + GAP;
    let blockD = 9;
    for (const [, row] of rows) {
      const w = row.reduce((s, u) => s + footprint(u.area, u.type).w + GAP, 0) + CORE_W + GAP;
      blockW = Math.max(blockW, w);
      blockD = Math.max(blockD, ...row.map((u) => footprint(u.area, u.type).d));
    }
    blockW = round(Math.max(blockW, 10));
    const zCentre = zCursor + blockD / 2;

    for (const f of floors) {
      const y = f * FLOOR_HEIGHT;
      slabs.push({ block, floor: f, x: blockW / 2, y, z: zCentre, w: blockW, d: blockD });
      const row = (rows.get(f) ?? []).slice().sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
      let x = CORE_W + GAP;
      for (const u of row) {
        const fp = footprint(u.area, u.type);
        boxes.push({
          id: u.id, number: u.number, block: u.block, floor: u.floor, type: u.type, bedrooms: u.bedrooms, bathrooms: u.bathrooms,
          area: u.area, status: u.status, tenantName: u.tenantName ?? null, rent: u.rent ?? null,
          x: round(x + fp.w / 2), y: round(y + SLAB), z: zCentre, w: fp.w, h: round(FLOOR_HEIGHT - SLAB - 0.15), d: fp.d,
          rooms: layoutRooms(u, fp.w, fp.d),
        });
        x += fp.w + GAP;
      }
    }
    cores.push({ block, x: CORE_W / 2 + 0.2, z: zCentre, w: CORE_W, d: Math.min(blockD, 6), h: round(floors.length * FLOOR_HEIGHT + 1) });
    maxW = Math.max(maxW, blockW);
    maxD = zCursor + blockD;
    zCursor += blockD + BLOCK_GAP;
  }

  return {
    blocks: blockNames,
    floors,
    units: boxes,
    slabs,
    cores,
    bounds: { w: round(maxW), h: round(floors.length * FLOOR_HEIGHT), d: round(maxD) },
    floorHeight: FLOOR_HEIGHT,
  };
}

export const STATUS_COLORS: Record<string, string> = {
  VACANT: "#60a5fa",
  RESERVED: "#a78bfa",
  OCCUPIED: "#34d399",
  NOTICE_GIVEN: "#fbbf24",
  UNDER_INSPECTION: "#f59e0b",
  UNDER_MAINTENANCE: "#f97316",
  UNAVAILABLE: "#94a3b8",
};

export const ROOM_COLORS: Record<string, string> = {
  LIVING: "#fde68a",
  KITCHEN: "#fca5a5",
  BEDROOM: "#bfdbfe",
  BATHROOM: "#a5f3fc",
  BALCONY: "#bbf7d0",
  STUDIO: "#fde68a",
  SHOP: "#fdba74",
  OFFICE: "#c7d2fe",
};
