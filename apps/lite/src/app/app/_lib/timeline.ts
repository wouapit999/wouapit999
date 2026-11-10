/**
 * Tracking timeline helpers (pure). Several events of one transfer are written in the same
 * database transaction and therefore carry the same timestamp; the life cycle below breaks
 * those ties so "Created" never shows after "Completed".
 */

export const EVENT_LABELS: Readonly<Record<string, string>> = {
  CREATED: 'Created',
  HELD: 'Held for review',
  RELEASED: 'Released',
  FUNDS_RESERVED: 'Funds reserved',
  SENT_TO_PROVIDER: 'Sent to the operator',
  PROVIDER_PENDING: 'Waiting for the operator',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  REJECTED: 'Not approved',
  REFUNDED: 'Refunded',
  REVERSED: 'Reversed',
};

const LIFE_CYCLE = [
  'CREATED',
  'SCREENED',
  'HELD',
  'RELEASED',
  'FUNDS_RESERVED',
  'SENT_TO_PROVIDER',
  'PROVIDER_PENDING',
  'FAILED',
  'REJECTED',
  'COMPLETED',
  'REFUNDED',
  'REVERSED',
] as const;

const rank = (type: string): number => {
  const index = (LIFE_CYCLE as readonly string[]).indexOf(type);
  return index === -1 ? LIFE_CYCLE.length : index;
};

/** Oldest first; events with the same timestamp follow the transfer life cycle. */
export function orderTimeline<Event extends { type: string; createdAt: Date }>(
  events: readonly Event[],
): Event[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        a.event.createdAt.getTime() - b.event.createdAt.getTime() ||
        rank(a.event.type) - rank(b.event.type) ||
        a.index - b.index,
    )
    .map(({ event }) => event);
}
