import { z } from 'zod';

import type { DeliveryMethod, TransferType } from '@/generated/prisma/enums';

import { writeAudit } from './audit';
import { type DbOrTx, type Tx, db } from './db';
import { AppError } from './errors';
import { TRANSFER_TYPES, quoteFee } from './fees';
import {
  RATE_SCALE,
  MAX_AMOUNT_MINOR,
  applyMargin,
  assertAmountInRange,
  bpsOf,
  convertAmount,
  currencyInfo,
  divRound,
  invertRate,
  isCurrencyCode,
  parseRate,
  rateToDecimalString,
} from './money';
import {
  type ActionContext,
  actorPartnerId,
  actorUserId,
  assertPermission,
  hasPermission,
} from './rbac';
import { getSetting } from './settings';

/**
 * FX: rate table (mid rate + margin per pair), pricing and locked quotes.
 *
 * A rate row says "1 major unit of `baseCurrency` = `midRate` major units of `quoteCurrency`".
 * The customer gets `mid × (1 − marginBps/10 000)`. For a cross-currency send of S (minor units):
 *
 *   fxMargin = round_half_up(S × marginBps / 10 000)            (source currency → FX revenue)
 *   receive  = floor(S × customerRate × 10^(expTarget − expSource))   (target currency)
 *   total    = S + fee                                           (debited from the sender)
 */

export interface ResolvedRate {
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  /** Scaled by 10^10. */
  readonly midRate: bigint;
  readonly marginBps: number;
  readonly source: string;
  /** True when no direct row exists and the rate was derived (inverse or via USD). */
  readonly derived: boolean;
  readonly updatedAt: Date | null;
}

const DEFAULT_MARGIN_BPS = 150;

/** Mid rate + margin for a pair. Falls back to the inverse row, then to triangulation via USD. */
export async function getRate(client: DbOrTx, base: string, quote: string): Promise<ResolvedRate> {
  currencyInfo(base);
  currencyInfo(quote);
  if (base === quote) {
    return {
      baseCurrency: base,
      quoteCurrency: quote,
      midRate: RATE_SCALE,
      marginBps: 0,
      source: 'identity',
      derived: false,
      updatedAt: null,
    };
  }
  const rows = await client.fxRate.findMany({
    where: {
      OR: [
        { baseCurrency: base, quoteCurrency: quote },
        { baseCurrency: quote, quoteCurrency: base },
        { baseCurrency: base, quoteCurrency: 'USD' },
        { baseCurrency: 'USD', quoteCurrency: quote },
      ],
    },
  });
  const find = (b: string, q: string) =>
    rows.find((row) => row.baseCurrency === b && row.quoteCurrency === q);

  const direct = find(base, quote);
  if (direct) {
    return {
      baseCurrency: base,
      quoteCurrency: quote,
      midRate: parseRate(direct.midRate),
      marginBps: direct.marginBps,
      source: direct.source,
      derived: false,
      updatedAt: direct.updatedAt,
    };
  }
  const inverse = find(quote, base);
  if (inverse) {
    return {
      baseCurrency: base,
      quoteCurrency: quote,
      midRate: invertRate(parseRate(inverse.midRate)),
      marginBps: inverse.marginBps,
      source: `${inverse.source} (inverse)`,
      derived: true,
      updatedAt: inverse.updatedAt,
    };
  }
  const toUsd = find(base, 'USD');
  const fromUsd = find('USD', quote);
  if (toUsd && fromUsd) {
    return {
      baseCurrency: base,
      quoteCurrency: quote,
      midRate: divRound(
        parseRate(toUsd.midRate) * parseRate(fromUsd.midRate),
        RATE_SCALE,
        'half_up',
      ),
      marginBps: Math.max(toUsd.marginBps, fromUsd.marginBps, DEFAULT_MARGIN_BPS),
      source: 'derived via USD',
      derived: true,
      updatedAt: toUsd.updatedAt < fromUsd.updatedAt ? toUsd.updatedAt : fromUsd.updatedAt,
    };
  }
  throw new AppError('UNSUPPORTED', `No FX rate available for ${base} → ${quote}`);
}

/** Value of an amount in USD cents at the mid rate (limits, AML thresholds, reporting). */
export async function toUsdMinor(
  client: DbOrTx,
  amount: bigint,
  currency: string,
): Promise<bigint> {
  if (currency === 'USD') return amount;
  const rate = await getRate(client, currency, 'USD');
  return convertAmount(amount, rate.midRate, currency, 'USD', 'half_up');
}

/** Value of USD cents in another currency at the mid rate (displaying limits). */
export async function fromUsdMinor(
  client: DbOrTx,
  usdMinor: bigint,
  currency: string,
): Promise<bigint> {
  if (currency === 'USD') return usdMinor;
  const rate = await getRate(client, 'USD', currency);
  return convertAmount(usdMinor, rate.midRate, 'USD', currency, 'floor');
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface PricingInput {
  readonly type: TransferType;
  readonly deliveryMethod: DeliveryMethod;
  readonly sourceCountry: string;
  readonly targetCountry: string;
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  /** Minor units of the source currency the recipient side is computed from. */
  readonly sendAmount: bigint;
}

export interface Pricing extends PricingInput {
  readonly feeAmount: bigint;
  readonly feeRuleId: string | null;
  /** FX margin in source-currency minor units (0 for same-currency transfers). */
  readonly fxMarginAmount: bigint;
  /** sendAmount + feeAmount. */
  readonly totalDebit: bigint;
  readonly receiveAmount: bigint;
  readonly midRate: bigint;
  readonly customerRate: bigint;
  readonly marginBps: number;
  /** USD cents at mid rate. */
  readonly sendAmountUsd: bigint;
  readonly revenueUsd: bigint;
}

/** Prices a transfer at current rates and fee rules. Pure read; nothing is stored. */
export async function priceTransfer(client: DbOrTx, input: PricingInput): Promise<Pricing> {
  assertAmountInRange(input.sendAmount);
  const { fee, ruleId } = await quoteFee(
    client,
    {
      type: input.type,
      currency: input.sourceCurrency,
      sourceCountry: input.sourceCountry,
      targetCountry: input.targetCountry,
    },
    input.sendAmount,
  );
  const rate = await getRate(client, input.sourceCurrency, input.targetCurrency);
  const crossCurrency = input.sourceCurrency !== input.targetCurrency;
  const customerRate = crossCurrency ? applyMargin(rate.midRate, rate.marginBps) : RATE_SCALE;
  const fxMarginAmount = crossCurrency ? bpsOf(input.sendAmount, rate.marginBps, 'half_up') : 0n;
  const receiveAmount = crossCurrency
    ? convertAmount(
        input.sendAmount,
        customerRate,
        input.sourceCurrency,
        input.targetCurrency,
        'floor',
      )
    : input.sendAmount;
  if (receiveAmount <= 0n) {
    throw new AppError('VALIDATION', 'Amount is too small to convert');
  }
  const [sendAmountUsd, revenueUsd] = await Promise.all([
    toUsdMinor(client, input.sendAmount, input.sourceCurrency),
    toUsdMinor(client, fee + fxMarginAmount, input.sourceCurrency),
  ]);
  return {
    ...input,
    feeAmount: fee,
    feeRuleId: ruleId,
    fxMarginAmount,
    totalDebit: input.sendAmount + fee,
    receiveAmount,
    midRate: rate.midRate,
    customerRate,
    marginBps: crossCurrency ? rate.marginBps : 0,
    sendAmountUsd,
    revenueUsd,
  };
}

// ---------------------------------------------------------------------------
// Quotes (locked rate)
// ---------------------------------------------------------------------------

export const quoteSchema = z.object({
  type: z.enum(TRANSFER_TYPES),
  deliveryMethod: z.enum(['WALLET', 'MOBILE_MONEY']),
  sourceCountry: z.string().length(2),
  targetCountry: z.string().length(2),
  sourceCurrency: z.string().refine(isCurrencyCode, 'Unsupported currency'),
  targetCurrency: z.string().refine(isCurrencyCode, 'Unsupported currency'),
  sendAmount: z.bigint().positive().max(MAX_AMOUNT_MINOR, 'Amount is too large'),
});
export type QuoteInput = PricingInput;

/**
 * Prices a transfer and stores the offer with its rate locked until `expiresAt`
 * (`fx.quoteTtlMinutes`, default 15). The quote belongs to the acting user or partner.
 */
export async function createQuote(
  ctx: ActionContext,
  input: QuoteInput,
  options: { client?: DbOrTx; now?: Date } = {},
) {
  const data = quoteSchema.parse(input);
  const client = options.client ?? db;
  const now = options.now ?? new Date();
  const pricing = await priceTransfer(client, data);
  const ttlMinutes = await getSetting('fx.quoteTtlMinutes', client);
  const partnerId = actorPartnerId(ctx);
  return client.quote.create({
    data: {
      userId: partnerId ? null : actorUserId(ctx),
      partnerId,
      type: pricing.type,
      deliveryMethod: pricing.deliveryMethod,
      sourceCountry: pricing.sourceCountry,
      targetCountry: pricing.targetCountry,
      sourceCurrency: pricing.sourceCurrency,
      targetCurrency: pricing.targetCurrency,
      sendAmount: pricing.sendAmount,
      feeAmount: pricing.feeAmount,
      fxMarginAmount: pricing.fxMarginAmount,
      totalDebit: pricing.totalDebit,
      receiveAmount: pricing.receiveAmount,
      midRate: rateToDecimalString(pricing.midRate),
      customerRate: rateToDecimalString(pricing.customerRate),
      marginBps: pricing.marginBps,
      feeRuleId: pricing.feeRuleId,
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
      createdAt: now,
    },
  });
}

function ownsQuote(
  ctx: ActionContext,
  quote: { userId: string | null; partnerId: string | null },
): boolean {
  if (ctx.actor.type === 'SYSTEM') return true;
  if (quote.partnerId) return actorPartnerId(ctx) === quote.partnerId;
  return ctx.actor.type === 'USER' && quote.userId === ctx.actor.id;
}

/** A quote the actor owns (or any quote for staff with `transfers:read`). */
export async function getQuote(ctx: ActionContext, quoteId: string) {
  const quote = await db.quote.findUnique({ where: { id: quoteId } });
  if (!quote || !(ownsQuote(ctx, quote) || hasPermission(ctx, 'transfers:read'))) {
    throw new AppError('NOT_FOUND', 'Quote not found');
  }
  return quote;
}

/**
 * Locks a quote row, checks it is ACTIVE, unexpired and owned by the actor, and marks it USED.
 * Called by the transfer engine inside its transaction; returns the locked pricing.
 */
export async function consumeQuote(
  tx: Tx,
  ctx: ActionContext,
  quoteId: string,
  now: Date = new Date(),
): Promise<Pricing & { quoteId: string }> {
  await tx.$queryRaw`SELECT id FROM quotes WHERE id = ${quoteId}::uuid FOR UPDATE`;
  const quote = await tx.quote.findUnique({ where: { id: quoteId } });
  if (!quote || !ownsQuote(ctx, quote)) throw new AppError('NOT_FOUND', 'Quote not found');
  if (quote.status === 'USED') throw new AppError('CONFLICT', 'This quote has already been used');
  if (quote.status === 'EXPIRED' || quote.expiresAt <= now) {
    if (quote.status === 'ACTIVE') {
      await tx.quote.update({ where: { id: quoteId }, data: { status: 'EXPIRED' } });
    }
    throw new AppError('QUOTE_EXPIRED', 'This quote has expired. Please request a new one.');
  }
  await tx.quote.update({ where: { id: quoteId }, data: { status: 'USED', usedAt: now } });
  const [sendAmountUsd, revenueUsd] = await Promise.all([
    toUsdMinor(tx, quote.sendAmount, quote.sourceCurrency),
    toUsdMinor(tx, quote.feeAmount + quote.fxMarginAmount, quote.sourceCurrency),
  ]);
  return {
    quoteId: quote.id,
    type: quote.type,
    deliveryMethod: quote.deliveryMethod,
    sourceCountry: quote.sourceCountry,
    targetCountry: quote.targetCountry,
    sourceCurrency: quote.sourceCurrency,
    targetCurrency: quote.targetCurrency,
    sendAmount: quote.sendAmount,
    feeAmount: quote.feeAmount,
    feeRuleId: quote.feeRuleId,
    fxMarginAmount: quote.fxMarginAmount,
    totalDebit: quote.totalDebit,
    receiveAmount: quote.receiveAmount,
    midRate: parseRate(quote.midRate),
    customerRate: parseRate(quote.customerRate),
    marginBps: quote.marginBps,
    sendAmountUsd,
    revenueUsd,
  };
}

/** Marks every ACTIVE quote past its expiry as EXPIRED. Returns how many were expired. */
export async function expireStaleQuotes(now: Date = new Date()): Promise<number> {
  const result = await db.quote.updateMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Rate administration
// ---------------------------------------------------------------------------

export async function listFxRates(
  ctx: ActionContext,
  filter: { baseCurrency?: string; quoteCurrency?: string } = {},
) {
  assertPermission(ctx, 'fx:read');
  return db.fxRate.findMany({
    where: {
      ...(filter.baseCurrency ? { baseCurrency: filter.baseCurrency } : {}),
      ...(filter.quoteCurrency ? { quoteCurrency: filter.quoteCurrency } : {}),
    },
    orderBy: [{ baseCurrency: 'asc' }, { quoteCurrency: 'asc' }],
  });
}

export const fxRateSchema = z
  .object({
    baseCurrency: z.string().trim().toUpperCase().refine(isCurrencyCode, 'Unsupported currency'),
    quoteCurrency: z.string().trim().toUpperCase().refine(isCurrencyCode, 'Unsupported currency'),
    /** Decimal string, up to 10 decimals. */
    midRate: z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,10})?$/, 'Enter a positive rate (max 10 decimals)'),
    marginBps: z.coerce.number().int().min(0).max(2000),
    /** Also set the inverse pair to 1/midRate with the same margin. */
    updateInverse: z.boolean().default(false),
    /** Why the rate is overridden by hand (recorded in the audit trail). */
    reason: z.string().trim().min(5, 'Explain the override').max(300).optional(),
  })
  .refine((value) => value.baseCurrency !== value.quoteCurrency, {
    message: 'Choose two different currencies',
    path: ['quoteCurrency'],
  });
export type FxRateInput = z.input<typeof fxRateSchema>;

/**
 * Manual rate override. Requires `fx:write`; audited with before/after. Existing quotes keep
 * their locked rate.
 */
export async function setFxRate(ctx: ActionContext, input: FxRateInput) {
  assertPermission(ctx, 'fx:write');
  const data = fxRateSchema.parse(input);
  const mid = parseRate(data.midRate);
  if (mid <= 0n) throw new AppError('VALIDATION', 'Rate must be greater than zero');
  const pairs: Array<{ base: string; quote: string; rate: bigint }> = [
    { base: data.baseCurrency, quote: data.quoteCurrency, rate: mid },
  ];
  if (data.updateInverse) {
    pairs.push({ base: data.quoteCurrency, quote: data.baseCurrency, rate: invertRate(mid) });
  }
  return db.$transaction(async (tx) => {
    const saved = [];
    for (const pair of pairs) {
      const where = {
        baseCurrency_quoteCurrency: { baseCurrency: pair.base, quoteCurrency: pair.quote },
      };
      const before = await tx.fxRate.findUnique({ where });
      const after = await tx.fxRate.upsert({
        where,
        create: {
          baseCurrency: pair.base,
          quoteCurrency: pair.quote,
          midRate: rateToDecimalString(pair.rate),
          marginBps: data.marginBps,
          source: 'manual',
          updatedById: actorUserId(ctx),
        },
        update: {
          midRate: rateToDecimalString(pair.rate),
          marginBps: data.marginBps,
          source: 'manual',
          updatedById: actorUserId(ctx),
        },
      });
      await writeAudit(tx, ctx, {
        action: 'fx_rate.override',
        resourceType: 'fx_rate',
        resourceId: `${pair.base}/${pair.quote}`,
        before: before
          ? { midRate: before.midRate, marginBps: before.marginBps, source: before.source }
          : null,
        after: {
          midRate: after.midRate,
          marginBps: after.marginBps,
          source: after.source,
          ...(data.reason ? { reason: data.reason } : {}),
        },
      });
      saved.push(after);
    }
    return saved;
  });
}
