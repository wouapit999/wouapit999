export const INSPECTION_TYPES = ["MOVE_IN", "MOVE_OUT", "ROUTINE"] as const;
export const CONDITIONS = ["GOOD", "FAIR", "POOR", "DAMAGED"] as const;
export const CHECK_ITEMS = ["walls", "floor", "doors", "windows", "electrical", "plumbing"] as const;

export interface ChecklistRow {
  /** Room key: entrance | living | kitchen | bedroom | bathroom | custom label. */
  room: string;
  /** Room number for bedrooms / bathrooms. */
  n?: number;
  item: string;
  condition: "" | (typeof CONDITIONS)[number];
  notes: string;
}

/** Default checklist from the unit layout: fixed rooms + one per bedroom / bathroom. */
export function defaultChecklist(bedrooms: number, bathrooms: number): ChecklistRow[] {
  const rooms: { room: string; n?: number }[] = [{ room: "entrance" }, { room: "living" }, { room: "kitchen" }];
  for (let i = 1; i <= Math.max(0, Math.min(bedrooms, 20)); i++) rooms.push({ room: "bedroom", n: i });
  for (let i = 1; i <= Math.max(0, Math.min(bathrooms, 20)); i++) rooms.push({ room: "bathroom", n: i });
  return rooms.flatMap((r) => CHECK_ITEMS.map((item) => ({ ...r, item, condition: "" as const, notes: "" })));
}

/** Defensive parse of the `items` JSON column. */
export function parseChecklist(v: unknown): ChecklistRow[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      room: String(r.room ?? ""),
      n: typeof r.n === "number" ? r.n : undefined,
      item: String(r.item ?? ""),
      condition: (CONDITIONS as readonly string[]).includes(String(r.condition)) ? (r.condition as ChecklistRow["condition"]) : "",
      notes: String(r.notes ?? ""),
    }));
}

export const rowKey = (r: Pick<ChecklistRow, "room" | "n" | "item">) => `${r.room}#${r.n ?? ""}#${r.item}`;
