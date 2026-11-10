import { listMyWallets } from '@/server/wallets';

import { API_VERSION, v1Json, v1Route } from '../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/me — who this API key acts for. Wallet balances are included only when the key
 * holds the `wallets:read` scope.
 */
export const GET = v1Route({}, async ({ auth }) => {
  const wallets = auth.scopes.includes('wallets:read') ? await listMyWallets(auth.ctx) : null;
  return v1Json({
    apiVersion: API_VERSION,
    partner: {
      id: auth.partner.id,
      code: auth.partner.code,
      name: auth.partner.name,
      type: auth.partner.type,
      countryCode: auth.partner.countryCode,
      currency: auth.partner.currency,
    },
    apiKey: { id: auth.ctx.actor.id, scopes: auth.scopes },
    wallets:
      wallets?.map((wallet) => ({
        id: wallet.id,
        currency: wallet.currency,
        balance: wallet.balance.toString(),
        status: wallet.status,
      })) ?? null,
  });
});
