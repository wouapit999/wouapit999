import { z } from 'zod';

import { PAGINATION } from '../constants/api-routes.js';
import { COUNTRY_CODES } from '../constants/countries.js';
import { CURRENCY_CODES } from '../constants/currencies.js';
import { SUPPORTED_LOCALES } from '../constants/locales.js';
import { CORRELATION_ID_PATTERN } from '../utils/ids.js';
import { E164_PATTERN } from '../utils/phone.js';

export const uuidSchema = z.uuid({ error: 'Must be a UUID' });

/** Lower-cased, trimmed email (max length per RFC 5321). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'Invalid email address' }));

export const e164PhoneSchema = z
  .string()
  .trim()
  .regex(E164_PATTERN, { error: 'Phone number must be in E.164 format, e.g. +237655123456' });

export const localeSchema = z.enum(SUPPORTED_LOCALES);
export const countryCodeSchema = z.enum(COUNTRY_CODES);
export const currencyCodeSchema = z.enum(CURRENCY_CODES);

export const isoDateTimeSchema = z.iso.datetime({
  offset: true,
  error: 'Must be an ISO-8601 date-time',
});

export const correlationIdSchema = z.string().regex(CORRELATION_ID_PATTERN);

/** Human-entered names: trimmed, 1–100 chars, letters/marks/spaces/apostrophes/hyphens. */
export const personNameSchema = z
  .string()
  .trim()
  .min(1, { error: 'Required' })
  .max(100)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u, { error: 'Contains unsupported characters' });

/** BIGINT minor units travel as decimal-digit strings in JSON. */
export const minorUnitsSchema = z
  .string()
  .regex(/^-?\d{1,19}$/, { error: 'Must be an integer amount of minor units as a string' });

export const moneySchema = z.object({
  amount: minorUnitsSchema,
  currency: currencyCodeSchema,
});
export type MoneyDto = z.infer<typeof moneySchema>;

/** Refinement helper for PATCH bodies: at least one property must be present. */
export function hasAnyDefinedField(value: Record<string, unknown>): boolean {
  return Object.values(value).some((field) => field !== undefined);
}

export const idParamSchema = z.object({ id: uuidSchema });
export type IdParam = z.infer<typeof idParamSchema>;

export const sortOrderSchema = z.enum(['asc', 'desc']);
export type SortOrder = z.infer<typeof sortOrderSchema>;

/** Query-string pagination; values arrive as strings so they are coerced. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.defaultPage),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.maxPageSize)
    .default(PAGINATION.defaultPageSize),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Builds a list query schema with pagination plus a constrained `sortBy` field.
 * `sortBy` is restricted to an allow-list so clients can never sort on arbitrary columns.
 */
export function createListQuerySchema<const TSort extends readonly [string, ...string[]]>(
  sortableFields: TSort,
  defaultSort: TSort[number],
) {
  return paginationQuerySchema.extend({
    sortBy: z.enum(sortableFields).default(defaultSort),
    sortOrder: sortOrderSchema.default('desc'),
  });
}

export const paginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalItems: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export function createPaginatedSchema<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    data: z.array(item),
    meta: paginationMetaSchema,
  });
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export function buildPaginationMeta(
  page: number,
  pageSize: number,
  totalItems: number,
): PaginationMeta {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
  };
}

/** Stable, machine-readable error codes returned by the API. */
export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'MFA_REQUIRED',
  'MFA_INVALID',
  'TOKEN_EXPIRED',
  'TOKEN_REVOKED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'ACCOUNT_LOCKED',
  'ACCOUNT_SUSPENDED',
  'EMAIL_NOT_VERIFIED',
  'WEAK_PASSWORD',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;
export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/** One field-level validation failure. */
export const fieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string(),
  details: z.array(fieldErrorSchema).optional(),
  correlationId: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const responseMetaSchema = z.object({
  correlationId: z.string(),
  timestamp: isoDateTimeSchema,
});

/** Success envelope: `{ success: true, data, meta }`. */
export function createApiResponseSchema<TData extends z.ZodType>(data: TData) {
  return z.object({
    success: z.literal(true),
    data,
    meta: responseMetaSchema.optional(),
  });
}

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: z.infer<typeof responseMetaSchema>;
}

export const apiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: apiErrorSchema,
  meta: responseMetaSchema.optional(),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export function createApiResultSchema<TData extends z.ZodType>(data: TData) {
  return z.discriminatedUnion('success', [createApiResponseSchema(data), apiErrorResponseSchema]);
}

/**
 * RFC 9457 Problem Details, the wire format of API errors (`application/problem+json`).
 * Extension members carry the stable `code`, field `errors` and the `correlationId`.
 */
export const problemDetailsSchema = z.looseObject({
  type: z.url().default('about:blank'),
  title: z.string().min(1),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: apiErrorCodeSchema.optional(),
  errors: z.array(fieldErrorSchema).optional(),
  correlationId: z.string().optional(),
  timestamp: isoDateTimeSchema.optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

/** Converts a `ZodError` into the field-error list used by both envelopes. */
export function zodIssuesToFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));
}
