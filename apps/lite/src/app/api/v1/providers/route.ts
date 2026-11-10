import { listAvailableProviders } from '@/server/connectors/providers';

import { queryObject, v1Json, v1Route } from '../_lib/handler';
import { providersQuerySchema } from '../_lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/providers?country=CM&currency=XAF — mobile-money providers a payout can be sent
 * to. `simulated: true` means the provider is the sandbox simulator, not a live operator.
 */
export const GET = v1Route({}, async ({ url }) => {
  const query = providersQuerySchema.parse(queryObject(url));
  const providers = await listAvailableProviders({
    countryCode: query.country,
    currency: query.currency,
  });
  return v1Json(
    providers.map((provider) => ({
      code: provider.code,
      name: provider.name,
      operator: provider.operator,
      countryCode: provider.countryCode,
      currency: provider.currency,
      supportsPayout: provider.supportsPayout,
      supportsCollection: provider.supportsCollection,
      simulated: provider.simulated,
    })),
  );
});
