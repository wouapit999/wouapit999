import type { ApiEndpoint } from '@/app/api/v1/_lib/reference';

/** Code samples of the API reference. Pure string builders — nothing here runs. */

const json = (value: unknown): string => JSON.stringify(value, null, 2);

/** A copy-pasteable curl command for an endpoint, against this deployment's own origin. */
export function curlFor(endpoint: ApiEndpoint, origin: string): string {
  const path = `${endpoint.examplePath ?? endpoint.path}${endpoint.exampleQuery ?? ''}`;
  const lines = [
    `curl -sS${endpoint.method === 'POST' ? ' -X POST' : ''} "${origin}${path}"`,
    `  -H "Authorization: Bearer $BIREM_API_KEY"`,
  ];
  if (endpoint.headers?.some((header) => header.name === 'Idempotency-Key')) {
    lines.push(`  -H "Idempotency-Key: $(uuidgen)"`);
  }
  if (endpoint.body) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${JSON.stringify(endpoint.body.example)}'`);
  }
  return lines.join(' \\\n');
}

export const responseFor = (endpoint: ApiEndpoint): string => json(endpoint.responseExample);

export const pretty = json;

export const quickStart = (origin: string): string =>
  [
    '# 1. Keep the key out of your shell history and your code',
    'export BIREM_API_KEY="brl_…"',
    '',
    '# 2. Check the key and see your balance',
    `curl -sS "${origin}/api/v1/me" -H "Authorization: Bearer $BIREM_API_KEY"`,
    '',
    '# 3. Send 25 000 XAF to a BI-Rem wallet (amounts are minor units)',
    `curl -sS -X POST "${origin}/api/v1/transfers" \\`,
    '  -H "Authorization: Bearer $BIREM_API_KEY" \\',
    '  -H "Idempotency-Key: $(uuidgen)" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '{"recipient":{"type":"wallet","identifier":"+237699000101"},"amount":"25000"}'`,
  ].join('\n');

export const payoutSample = (origin: string): string =>
  [
    '# Mobile-money payout (sandbox: the operator is simulated).',
    '# Account numbers ending 0003 stay PROCESSING until refreshed; 0001 fails and is refunded.',
    `curl -sS -X POST "${origin}/api/v1/transfers" \\`,
    '  -H "Authorization: Bearer $BIREM_API_KEY" \\',
    '  -H "Idempotency-Key: payout-2026-11-10-0001" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '{"recipient":{"type":"mobile_money","provider":"mtn-momo-cm","accountNumber":"237677123456","name":"Paul Essomba"},"amount":"15000"}'`,
  ].join('\n');

export const VERIFY_NODE = `import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 300;

/**
 * rawBody: the request body exactly as received (a string, before JSON.parse).
 * header:  the x-birem-signature header, "t=<unix seconds>,v1=<hex>".
 */
export function verifyBiRemSignature(rawBody, header, secret) {
  const parts = Object.fromEntries(
    String(header ?? '').split(',').map((part) => part.trim().split('=')),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) return false;

  // Reject old messages: a captured request cannot be replayed later.
  if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1, 'hex'));
}

// Express: keep the raw body, verify, de-duplicate on the event id, answer 2xx quickly.
app.post('/webhooks/bi-rem', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = req.body.toString('utf8');
  if (!verifyBiRemSignature(rawBody, req.get('x-birem-signature'), process.env.BIREM_WEBHOOK_SECRET)) {
    return res.status(401).end();
  }
  const event = JSON.parse(rawBody);
  if (await alreadyProcessed(event.id)) return res.status(200).end(); // retries reuse the id
  await handle(event); // e.g. event.type === 'transfer.completed'
  res.status(200).end();
});`;

export const VERIFY_PYTHON = `import hashlib, hmac, time

TOLERANCE_SECONDS = 300

def verify_birem_signature(raw_body: bytes, header: str, secret: str) -> bool:
    """raw_body: the body exactly as received. header: 't=<unix seconds>,v1=<hex>'."""
    parts = dict(p.strip().split("=", 1) for p in (header or "").split(",") if "=" in p)
    try:
        timestamp = int(parts["t"])
        signature = parts["v1"]
    except (KeyError, ValueError):
        return False
    if abs(time.time() - timestamp) > TOLERANCE_SECONDS:
        return False  # too old: refuse replays
    expected = hmac.new(
        secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)`;

export const WEBHOOK_HEADERS_SAMPLE = `POST /webhooks/bi-rem HTTP/1.1
Content-Type: application/json
User-Agent: BI-Rem-Lite-Webhooks/1.0
x-birem-event: transfer.completed
x-birem-delivery: 8f1d6c0a-2b3e-4d5f-9a7b-6c5d4e3f2a1b
x-birem-signature: t=1794302044,v1=5f8d…(64 hex characters)`;
