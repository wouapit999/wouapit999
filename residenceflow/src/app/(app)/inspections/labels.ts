import type { T } from "@/i18n";
import { CHECK_ITEMS, type ChecklistRow } from "./checklist";

const ROOMS = ["entrance", "living", "kitchen", "bedroom", "bathroom"];

export function roomLabel(t: T, r: Pick<ChecklistRow, "room" | "n">) {
  return ROOMS.includes(r.room) ? t(`insp.room.${r.room}`, { n: r.n ?? "" }).trim() : r.room;
}

export function itemLabel(t: T, item: string) {
  return (CHECK_ITEMS as readonly string[]).includes(item) ? t(`insp.item.${item}`) : item;
}

export const CONDITION_TONE: Record<string, "green" | "blue" | "amber" | "red" | "slate"> = { GOOD: "green", FAIR: "blue", POOR: "amber", DAMAGED: "red" };
