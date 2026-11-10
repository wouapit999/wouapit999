import { apiHandler, apiOk } from '@/lib/http';
import { WEBHOOK_SIGNATURE_HEADER, handleProviderWebhook } from '@/server/connectors/webhooks';
import { AppError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;

/**
 * POST /api/webhooks/providers/<providerCode> — inbound status callback from a mobile-money
 * operator (phase 4). Unauthenticated by session on purpose: the request is authenticated by
 * its signature. `handleProviderWebhook` verifies `x-birem-signature` against the provider's
 * webhook secret over the RAW body, enforces the ±5 minute window, rate-limits per provider and
 * de-duplicates on `(provider, eventId)`, so a replay is acknowledged but never applied twice.
 *
 * 200 for PROCESSED / DUPLICATE / IGNORED; 401 for a bad or missing signature; 404 for an
 * unknown provider; 400 for a malformed body; 429 when rate limited.
 */
export const POST = apiHandler(
  async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
    const { code } = await params;
    if (!/^[a-z0-9][a-z0-9-]{2,40}$/i.test(code)) {
      throw new AppError('NOT_FOUND', 'Unknown provider');
    }
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) throw new AppError('VALIDATION', 'Request body is too large');
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      throw new AppError('VALIDATION', 'Request body is too large');
    }
    const result = await handleProviderWebhook({
      providerCode: code,
      rawBody,
      signature: request.headers.get(WEBHOOK_SIGNATURE_HEADER),
    });
    return apiOk(result);
  },
);
