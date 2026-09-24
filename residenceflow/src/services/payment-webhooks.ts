import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { money } from "@/lib/money";
import type { AuthContext } from "@/lib/auth/context";
import type { VerifiedPaymentEvent } from "@/lib/payments/provider";
import { approvePayment, rejectPayment } from "./billing";

/**
 * Applies a verified provider event to the pending payment created when the intent was issued
 * (matched by method GATEWAY/MOBILE_MONEY + externalRef). Exactly-once: payments already
 * confirmed/rejected are ignored; amount mismatches are never confirmed.
 */
export async function processProviderEvent(providerKey: string, event: VerifiedPaymentEvent) {
  if (!event.providerReference) return "ignored:no_reference";
  const payment = await db.payment.findFirst({
    where: { externalRef: event.providerReference, method: { in: ["GATEWAY", "MOBILE_MONEY", "CARD"] } },
  });
  if (!payment) return "ignored:unknown_reference";
  if (payment.status !== "PENDING") return `ignored:already_${payment.status.toLowerCase()}`;
  const system = {
    organizationId: payment.organizationId,
    user: { id: `system:${providerKey}`, name: `Payment provider (${providerKey})`, email: "", locale: null, mustChangePassword: false, isPlatformAdmin: false, mfaEnabled: false },
    permissions: new Set<string>(), roleKeys: [], scope: "ORGANIZATION", propertyIds: "ALL", tenantId: null, vendorId: null, sessionId: "webhook",
  } as unknown as AuthContext;

  if (event.status === "SUCCEEDED") {
    if (!money(event.amount).eq(money(payment.amount)) || (event.currency && event.currency !== payment.currency)) {
      await audit(system, { action: "payment.webhook_mismatch", module: "billing", entityType: "Payment", entityId: payment.id, result: "FAILURE", metadata: { eventId: event.eventId, amount: event.amount } });
      return "rejected:amount_mismatch";
    }
    await approvePayment(system, payment.id);
    return "confirmed";
  }
  if (event.status === "FAILED") {
    await rejectPayment(system, payment.id, `Provider reported failure (${event.eventId || "no event id"})`);
    return "rejected";
  }
  return "pending";
}
