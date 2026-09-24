import "server-only";
import { db, type Tx } from "@/lib/db";
import { paymentWhere, type AuthContext } from "@/lib/auth/context";
import type { CandidatePayment } from "@/domain/reconciliation";

const DAY = 86_400_000;
export const MATCH_WINDOW_DAYS = 3;

/** Payments in the user's scope that can be matched against a statement (period ± window). */
export async function candidatePayments(ctx: AuthContext, periodStart: Date, periodEnd: Date, tx: Tx = db): Promise<CandidatePayment[]> {
  const rows = await tx.payment.findMany({
    where: {
      AND: [
        paymentWhere(ctx),
        { status: { in: ["CONFIRMED", "PENDING"] } },
        { paymentDate: { gte: new Date(periodStart.getTime() - MATCH_WINDOW_DAYS * DAY), lte: new Date(periodEnd.getTime() + MATCH_WINDOW_DAYS * DAY) } },
      ],
    },
    orderBy: { paymentDate: "asc" },
    select: { id: true, reference: true, externalRef: true, amount: true, paymentDate: true },
  });
  return rows.map((p) => ({ ...p, amount: p.amount.toString() }));
}
