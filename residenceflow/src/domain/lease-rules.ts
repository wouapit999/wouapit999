export interface LeaseWindow {
  id?: string;
  startDate: Date;
  endDate: Date;
  status: string;
}

export const BLOCKING_LEASE_STATUSES = ["ACTIVE", "NOTICE_GIVEN", "PENDING_APPROVAL"];

/** Two inclusive date ranges overlap. */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Returns conflicting leases for a unit unless shared tenancy is enabled. */
export function findOverlaps(candidate: LeaseWindow, existing: LeaseWindow[], sharedTenancy = false) {
  if (sharedTenancy) return [];
  return existing.filter(
    (l) =>
      l.id !== candidate.id &&
      BLOCKING_LEASE_STATUSES.includes(l.status) &&
      rangesOverlap(candidate.startDate, candidate.endDate, l.startDate, l.endDate),
  );
}

export interface ActivationInput {
  unitId?: string | null;
  tenantId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  rentAmount?: string | number | null;
  frequency?: string | null;
  dueDay?: number | null;
}

/** Business rule 2: activation requires unit, tenant, dates, rent, frequency and due-date rule. */
export function activationErrors(l: ActivationInput): string[] {
  const errs: string[] = [];
  if (!l.unitId) errs.push("unit");
  if (!l.tenantId) errs.push("tenant");
  if (!l.startDate || !l.endDate) errs.push("dates");
  if (l.startDate && l.endDate && l.endDate < l.startDate) errs.push("dateOrder");
  if (l.rentAmount === null || l.rentAmount === undefined || Number(l.rentAmount) <= 0) errs.push("rent");
  if (!l.frequency) errs.push("frequency");
  if (!l.dueDay || l.dueDay < 1 || l.dueDay > 31) errs.push("dueDay");
  return errs;
}

export const LEASE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PENDING_APPROVAL", "ARCHIVED"],
  PENDING_APPROVAL: ["ACTIVE", "DRAFT"],
  ACTIVE: ["NOTICE_GIVEN", "TERMINATED", "EXPIRED", "RENEWED"],
  NOTICE_GIVEN: ["TERMINATED", "EXPIRED", "ACTIVE"],
  EXPIRED: ["ARCHIVED", "RENEWED"],
  TERMINATED: ["ARCHIVED"],
  RENEWED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransitionLease(from: string, to: string) {
  return LEASE_TRANSITIONS[from]?.includes(to) ?? false;
}
