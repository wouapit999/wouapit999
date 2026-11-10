import { z } from 'zod';

import { AppError, type ErrorCode } from '@/server/errors';

/**
 * RFC 9457 problem details for the public API. Every error of `/api/v1/**` is served as
 * `application/problem+json` with a stable machine-readable `code`; internals never leak —
 * anything that is not an `AppError` or a validation error becomes a generic 500.
 */

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export interface ProblemDetails {
  /** Stable identifier of the problem class, e.g. `urn:bi-rem:problem:insufficient-funds`. */
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  /** Machine-readable error code (same vocabulary as the rest of BI-Rem Lite). */
  readonly code: ErrorCode;
  /** Path of the request that failed. */
  readonly instance?: string;
  /** Correlation id — quote it when contacting support. */
  readonly requestId?: string;
  /** Per-field validation messages. */
  readonly errors?: Readonly<Record<string, readonly string[]>>;
  /** Seconds to wait before retrying (429 only). */
  readonly retryAfterSeconds?: number;
  /** Minor units available / required (422 insufficient funds only). */
  readonly available?: string;
  readonly required?: string;
}

export const PROBLEM_TITLES: Readonly<Record<ErrorCode, string>> = {
  VALIDATION: 'Invalid request',
  UNAUTHENTICATED: 'Authentication required',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not found',
  CONFLICT: 'Conflict',
  INVALID_STATE: 'Invalid state',
  INSUFFICIENT_FUNDS: 'Insufficient funds',
  LIMIT_EXCEEDED: 'Limit exceeded',
  KYC_REQUIRED: 'Verification required',
  QUOTE_EXPIRED: 'Quote expired',
  UNSUPPORTED: 'Not supported',
  RATE_LIMITED: 'Too many requests',
  PROVIDER_ERROR: 'Provider error',
  INTERNAL: 'Internal server error',
};

export const problemType = (code: ErrorCode): string =>
  `urn:bi-rem:problem:${code.toLowerCase().replaceAll('_', '-')}`;

export interface ProblemResult {
  readonly status: number;
  readonly body: ProblemDetails;
  readonly headers: Readonly<Record<string, string>>;
}

const stringDetail = (
  details: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  const value = details?.[key];
  return typeof value === 'string' && /^\d{1,30}$/.test(value) ? value : undefined;
};

/**
 * Maps any thrown value to a problem document. `AppError` keeps its code, message and field
 * errors; `ZodError` becomes a 400 with one entry per invalid field; everything else is a 500
 * whose detail says nothing about the cause.
 */
export function toProblem(
  error: unknown,
  context: { instance?: string; requestId?: string } = {},
): ProblemResult {
  const base = (code: ErrorCode, status: number, detail: string) => ({
    type: problemType(code),
    title: PROBLEM_TITLES[code],
    status,
    detail,
    code,
    ...(context.instance ? { instance: context.instance } : {}),
    ...(context.requestId ? { requestId: context.requestId } : {}),
  });

  if (error instanceof AppError) {
    const headers: Record<string, string> = {};
    const retryAfter = error.details?.retryAfterSeconds;
    const retryAfterSeconds =
      error.code === 'RATE_LIMITED' && typeof retryAfter === 'number' && retryAfter > 0
        ? Math.ceil(retryAfter)
        : undefined;
    if (retryAfterSeconds !== undefined) headers['retry-after'] = String(retryAfterSeconds);
    if (error.code === 'UNAUTHENTICATED') headers['www-authenticate'] = 'Bearer realm="bi-rem"';
    const available = stringDetail(error.details, 'available');
    const required = stringDetail(error.details, 'required');
    return {
      status: error.status,
      headers,
      body: {
        ...base(error.code, error.status, error.message),
        ...(error.fieldErrors ? { errors: error.fieldErrors } : {}),
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        ...(error.code === 'INSUFFICIENT_FUNDS' && available && required
          ? { available, required }
          : {}),
      },
    };
  }

  if (error instanceof z.ZodError) {
    const errors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      (errors[issue.path.map(String).join('.') || '_'] ??= []).push(issue.message);
    }
    return {
      status: 400,
      headers: {},
      body: { ...base('VALIDATION', 400, 'The request is not valid'), errors },
    };
  }

  return {
    status: 500,
    headers: {},
    body: base('INTERNAL', 500, 'Something went wrong on our side. Please retry later.'),
  };
}
