export const PO_STATUSES = ["REQUESTED", "APPROVED", "ORDERED", "RECEIVED", "REJECTED", "CANCELLED"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/** Allowed status transitions. */
export const PO_TRANSITIONS: Record<PoStatus, PoStatus[]> = {
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["ORDERED", "CANCELLED"],
  ORDERED: ["RECEIVED", "CANCELLED"],
  RECEIVED: [],
  REJECTED: [],
  CANCELLED: [],
};

/** Statuses from which an expense may be created against the PO. */
export const PO_EXPENSABLE_STATUSES: PoStatus[] = ["APPROVED", "ORDERED", "RECEIVED"];
