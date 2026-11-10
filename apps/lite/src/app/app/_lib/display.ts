/** Small display rules of the customer area (pure — shared by components and unit tests). */

/**
 * Net effect of a transfer on the viewer's wallet, for the sign shown in lists. Money counts as
 * "out" while it is reserved or paid, and as "in" only once it has arrived; a failed, rejected
 * or reversed transfer moved nothing in the end.
 */
export function transferEffect(
  direction: 'sent' | 'received',
  status: string,
): 'debit' | 'credit' | 'none' {
  if (direction === 'received') return status === 'COMPLETED' ? 'credit' : 'none';
  return status === 'COMPLETED' || status === 'PROCESSING' || status === 'ON_HOLD'
    ? 'debit'
    : 'none';
}

/** Share of a limit already used, as a whole percentage 0–100 (display only, never for money). */
export function usedPercent(limit: bigint, remaining: bigint): number {
  if (limit <= 0n) return 0;
  const left = remaining < 0n ? 0n : remaining > limit ? limit : remaining;
  return Number(((limit - left) * 100n) / limit);
}
