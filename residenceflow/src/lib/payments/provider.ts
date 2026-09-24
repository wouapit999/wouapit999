import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/auth/crypto";

export interface CreatePaymentIntentInput {
  amount: string;
  currency: string;
  reference: string; // our internal payment reference
  customerPhone?: string;
  description: string;
}
export interface PaymentIntentResult {
  providerReference: string;
  redirectUrl?: string;
  instructions?: string;
}
export interface VerifiedPaymentEvent {
  eventId: string;
  providerReference: string;
  status: "SUCCEEDED" | "FAILED" | "PENDING";
  amount: string;
  currency: string;
}
export interface ProviderTransactionStatus {
  providerReference: string;
  status: "SUCCEEDED" | "FAILED" | "PENDING";
  amount?: string;
}
export interface RefundInput { providerReference: string; amount: string; reason: string }
export interface RefundResult { refundReference: string; status: "PENDING" | "SUCCEEDED" | "FAILED" }

/** Provider adapter contract: add MTN MoMo, Orange Money, card gateways etc. behind this interface. */
export interface PaymentProvider {
  readonly key: string;
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult>;
  verifyWebhook(headers: Headers, rawBody: string): Promise<VerifiedPaymentEvent>;
  queryTransaction(reference: string): Promise<ProviderTransactionStatus>;
  refund?(input: RefundInput): Promise<RefundResult>;
}

export class WebhookVerificationError extends Error {}

/**
 * Generic HMAC-SHA256 webhook adapter (header `x-signature: sha256=<hex>` over the raw body,
 * `x-timestamp` within 5 minutes). Used for integration testing and as a template for real
 * providers. It does NOT talk to any real payment network.
 */
export class GenericHmacProvider implements PaymentProvider {
  readonly key = "generic";
  constructor(private secret: string) {}

  async createPaymentIntent(): Promise<PaymentIntentResult> {
    throw new Error("The generic provider cannot initiate payments. Configure a real provider adapter.");
  }

  async verifyWebhook(headers: Headers, rawBody: string): Promise<VerifiedPaymentEvent> {
    const sig = headers.get("x-signature") ?? "";
    const ts = Number(headers.get("x-timestamp") ?? 0);
    if (!this.secret) throw new WebhookVerificationError("webhook secret not configured");
    if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) throw new WebhookVerificationError("stale timestamp");
    const expected = "sha256=" + createHmac("sha256", this.secret).update(`${ts}.${rawBody}`).digest("hex");
    if (!safeEqual(sig, expected)) throw new WebhookVerificationError("bad signature");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new WebhookVerificationError("invalid json");
    }
    const status = String(body.status ?? "").toUpperCase();
    if (!["SUCCEEDED", "FAILED", "PENDING"].includes(status)) throw new WebhookVerificationError("invalid status");
    return {
      eventId: String(body.eventId ?? ""),
      providerReference: String(body.reference ?? ""),
      status: status as VerifiedPaymentEvent["status"],
      amount: String(body.amount ?? "0"),
      currency: String(body.currency ?? ""),
    };
  }

  async queryTransaction(reference: string): Promise<ProviderTransactionStatus> {
    return { providerReference: reference, status: "PENDING" };
  }
}

export function getProvider(key: string): PaymentProvider | null {
  if (key === "generic") return new GenericHmacProvider(process.env.PAYMENT_WEBHOOK_SECRET ?? "");
  return null;
}

export function signGenericWebhook(secret: string, body: string, ts = Math.floor(Date.now() / 1000)) {
  return { ts, signature: "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex") };
}
