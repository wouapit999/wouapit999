import 'server-only';

import { NextResponse } from 'next/server';
import type { z } from 'zod';

import { HTTP_HEADERS, type ProblemDetails, zodIssuesToFieldErrors } from '@bi-rem/shared';

import { ApiError } from '@/lib/api';

/** Emits an RFC 9457 problem response from a route handler. */
export function problemResponse(
  problem: ProblemDetails,
  init?: { headers?: HeadersInit },
): NextResponse {
  return NextResponse.json(problem, {
    status: problem.status,
    headers: {
      'content-type': 'application/problem+json',
      'cache-control': 'no-store',
      ...init?.headers,
    },
  });
}

/** Re-emits an upstream {@link ApiError} to the browser without leaking internals. */
export function problemFromApiError(error: ApiError): NextResponse {
  const status = error.status === 0 ? 502 : error.status;
  return problemResponse({
    type: 'about:blank',
    title: error.status === 0 ? 'Upstream unavailable' : error.title,
    status,
    ...(error.detail !== undefined ? { detail: error.detail } : {}),
    ...(error.code !== 'UNKNOWN_ERROR' &&
    error.code !== 'INVALID_RESPONSE' &&
    error.code !== 'NETWORK_ERROR'
      ? { code: error.code }
      : {}),
    ...(error.errors.length > 0 ? { errors: [...error.errors] } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  });
}

const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

/**
 * CSRF guard for cookie-authenticated, state-changing BFF requests.
 *
 * HTML forms can only submit `application/x-www-form-urlencoded`, `multipart/form-data` or
 * `text/plain`, and a cross-origin `fetch` with `application/json` is blocked by the CORS
 * preflight. Requiring a JSON content type on every mutating request therefore rules out
 * classic form-based CSRF (login CSRF, forced logout) without a token. `Sec-Fetch-Site`, sent
 * by all current browsers, is checked as a second, independent layer on top of SameSite cookies.
 *
 * Returns a problem response when the request must be rejected, `null` when it may proceed.
 */
export function rejectCrossSiteRequest(request: Request): NextResponse | null {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return null;

  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite === 'cross-site') {
    return problemResponse({
      type: 'about:blank',
      title: 'Cross-site request rejected',
      status: 403,
      code: 'FORBIDDEN',
    });
  }

  const contentType = request.headers.get('content-type');
  const hasDeclaredBody =
    contentType !== null ||
    (request.headers.get('content-length') ?? '0') !== '0' ||
    request.headers.has('transfer-encoding');
  if (hasDeclaredBody && !isJsonContentType(contentType)) {
    return problemResponse({
      type: 'about:blank',
      title: 'Unsupported media type',
      status: 415,
      detail: 'Request bodies must be sent as application/json.',
    });
  }
  return null;
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * Parses and validates a JSON body, answering with a 400 problem when it is malformed. Applies
 * {@link rejectCrossSiteRequest} first, so every handler that reads a body is CSRF-guarded.
 * An absent body (no content type, empty payload) is treated as `{}` so bodyless POSTs work.
 */
export async function parseJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<ParsedBody<z.output<TSchema>>> {
  const rejected = rejectCrossSiteRequest(request);
  if (rejected) return { ok: false, response: rejected };

  let raw: unknown;
  try {
    const text = await request.text();
    raw = text.length === 0 ? {} : (JSON.parse(text) as unknown);
  } catch {
    return {
      ok: false,
      response: problemResponse({
        type: 'about:blank',
        title: 'Malformed JSON body',
        status: 400,
        code: 'VALIDATION_FAILED',
      }),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: problemResponse({
        type: 'about:blank',
        title: 'Validation failed',
        status: 400,
        code: 'VALIDATION_FAILED',
        errors: zodIssuesToFieldErrors(parsed.error),
      }),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Wraps a route handler so API failures become problem responses and anything else a 500 with
 * a correlation id, never a stack trace.
 */
export function withErrorHandling<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<NextResponse>,
): (...args: TArgs) => Promise<NextResponse> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return problemFromApiError(error);
      }
      const correlationId = crypto.randomUUID();
      console.error(`[admin] route handler failed (${correlationId})`, error);
      return problemResponse(
        {
          type: 'about:blank',
          title: 'Internal error',
          status: 500,
          code: 'INTERNAL_ERROR',
          correlationId,
        },
        { headers: { [HTTP_HEADERS.requestId]: correlationId } },
      );
    }
  };
}
