import { db } from '@/server/db';
import { AppError } from '@/server/errors';
import { getRate } from '@/server/fx';
import { CURRENCY_CODES, applyMargin, formatRate } from '@/server/money';

import { queryObject, v1Json, v1Route } from '../_lib/handler';
import { ratesQuerySchema } from '../_lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function rateFor(from: string, to: string) {
  const rate = await getRate(db, from, to);
  return {
    from,
    to,
    /** Mid-market rate: major units of `to` per major unit of `from`. */
    midRate: formatRate(rate.midRate),
    /** What a transfer gets today: mid rate less the margin. Lock it with POST /quotes. */
    rate: formatRate(applyMargin(rate.midRate, rate.marginBps)),
    marginBps: rate.marginBps,
    source: rate.source,
    updatedAt: rate.updatedAt?.toISOString() ?? null,
  };
}

/**
 * GET /api/v1/rates?from=XAF&to=AOA — indicative FX rate for a pair; without `to`, every
 * currency reachable from `from`. Indicative only: a quote locks the rate for 15 minutes.
 */
export const GET = v1Route({}, async ({ url }) => {
  const query = ratesQuerySchema.parse(queryObject(url));
  if (query.to) return v1Json(await rateFor(query.from, query.to));
  const rates = [];
  for (const to of CURRENCY_CODES) {
    if (to === query.from) continue;
    try {
      rates.push(await rateFor(query.from, to));
    } catch (error) {
      // A pair without any rate is simply not offered.
      if (!(error instanceof AppError && error.code === 'UNSUPPORTED')) throw error;
    }
  }
  return v1Json(rates);
});
