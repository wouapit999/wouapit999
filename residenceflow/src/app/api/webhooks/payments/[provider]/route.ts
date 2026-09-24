import { NextResponse } from "next/server";
import { getProvider, WebhookVerificationError } from "@/lib/payments/provider";
import { processProviderEvent } from "@/services/payment-webhooks";

/**
 * Payment provider webhooks. Signatures are verified before anything is read, events are
 * idempotent (provider reference + event id), and only SUCCEEDED events confirm a payment.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: key } = await params;
  const provider = getProvider(key);
  if (!provider) return NextResponse.json({ error: "unknown_provider" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 64_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  try {
    const event = await provider.verifyWebhook(req.headers, raw);
    const result = await processProviderEvent(provider.key, event);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    if (e instanceof WebhookVerificationError) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    console.error(JSON.stringify({ level: "error", msg: "webhook_failed", provider: key, error: (e as Error).message }));
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
