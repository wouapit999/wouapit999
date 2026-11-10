import { z } from 'zod';

import { isCurrencyCode } from '@/server/money';
import { SOURCES_OF_FUNDS, TRANSFER_PURPOSES } from '@/server/transfers';

/**
 * Request schemas of the public API. Amounts are integers in MINOR units of the currency
 * (XAF 1 500 → "1500", AOA 25.50 → "2550"), sent as strings; JSON integers are accepted as long
 * as they are exact (≤ 2^53 − 1). Floats are rejected — money is never a float.
 */

export const minorAmountSchema = z
  .union([
    z
      .string()
      .trim()
      .regex(/^[1-9]\d{0,17}$/, 'Amount must be a positive integer in minor units'),
    z
      .number()
      .int('Amount must be an integer in minor units')
      .positive('Amount must be positive')
      .max(Number.MAX_SAFE_INTEGER, 'Send large amounts as a string'),
  ])
  .transform((value) => BigInt(value));

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isCurrencyCode, 'Unsupported currency');

export const providerCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{2,40}$/, 'Unknown provider code');

export const recipientSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('wallet'),
    /** Phone (+237…), e-mail or partner code (M-…, A-…, P-…) of a BI-Rem account. */
    identifier: z.string().trim().min(3).max(254),
  }),
  z.object({
    type: z.literal('mobile_money'),
    /** Provider code from `GET /api/v1/providers`, e.g. `mtn-momo-cm`. */
    provider: providerCodeSchema,
    accountNumber: z.string().trim().min(8).max(20),
    name: z.string().trim().min(2).max(120),
  }),
]);
export type ApiRecipient = z.infer<typeof recipientSchema>;

export const quoteBodySchema = z.strictObject({
  /** Wallet to send from; defaults to the partner's home currency. */
  sourceCurrency: currencySchema.optional(),
  recipient: recipientSchema,
  amount: minorAmountSchema,
});

export const transferBodySchema = z
  .strictObject({
    sourceCurrency: currencySchema.optional(),
    recipient: recipientSchema,
    /** Send amount; optional when `quoteId` is given (the quote carries it). */
    amount: minorAmountSchema.optional(),
    quoteId: z.uuid().optional(),
    purpose: z.enum(TRANSFER_PURPOSES).optional(),
    sourceOfFunds: z.enum(SOURCES_OF_FUNDS).optional(),
    note: z.string().trim().max(140).optional(),
  })
  .refine((value) => value.amount !== undefined || value.quoteId !== undefined, {
    message: 'Provide an amount or a quoteId',
    path: ['amount'],
  });
export type TransferBody = z.infer<typeof transferBodySchema>;

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,100}$/;

const dateBound = z
  .union([z.iso.datetime({ offset: true }), z.iso.date()], 'Use an ISO 8601 date or date-time')
  .transform((value) => new Date(value));

export const transferListQuerySchema = z.object({
  status: z
    .enum(['PROCESSING', 'ON_HOLD', 'COMPLETED', 'FAILED', 'REJECTED', 'REVERSED'])
    .optional(),
  type: z.enum(['W2W', 'W2M', 'W2A', 'INTERNATIONAL', 'TOPUP']).optional(),
  direction: z.enum(['sent', 'received']).optional(),
  from: dateBound.optional(),
  to: dateBound.optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const ratesQuerySchema = z.object({
  from: currencySchema,
  to: currencySchema.optional(),
});

export const providersQuerySchema = z.object({
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use an ISO 3166-1 alpha-2 country code')
    .optional(),
  currency: currencySchema.optional(),
});

/** Transfer reference (`BR-…`) or id (uuid) path parameter. */
export const referenceParamSchema = z
  .string()
  .trim()
  .min(6)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/, 'Unknown transfer');
