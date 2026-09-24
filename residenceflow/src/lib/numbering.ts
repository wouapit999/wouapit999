import { db, type Tx } from "@/lib/db";

export const SEQUENCE_DEFAULTS: Record<string, { prefix: string; padding: number }> = {
  INVOICE: { prefix: "INV-", padding: 6 },
  RECEIPT: { prefix: "RCT-", padding: 6 },
  PAYMENT: { prefix: "PAY-", padding: 6 },
  LEASE: { prefix: "LSE-", padding: 5 },
  WORK_ORDER: { prefix: "WO-", padding: 5 },
  TENANT: { prefix: "TEN-", padding: 5 },
  PROPERTY: { prefix: "BLD-", padding: 3 },
  CREDIT_NOTE: { prefix: "CN-", padding: 5 },
};

/**
 * Allocates the next document number atomically. The UPDATE ... increment takes a row lock,
 * so concurrent callers inside transactions always receive distinct numbers.
 */
export async function nextNumber(organizationId: string, key: keyof typeof SEQUENCE_DEFAULTS, tx: Tx = db) {
  const def = SEQUENCE_DEFAULTS[key];
  const seq = await tx.numberSequence.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, prefix: def.prefix, padding: def.padding, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  const value = seq.nextValue - 1;
  return `${seq.prefix}${String(value).padStart(seq.padding, "0")}`;
}
