import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AppError } from '@/server/errors';
import { serialize } from '@/server/money';

/**
 * Helpers for Route Handlers (`/api/**`): consistent JSON envelopes, error mapping and binary
 * downloads. Money is serialised as strings (bigint minor units).
 */

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly fields?: Record<string, string[]>;
  };
}

/** `200 { data }` with bigint/Date/Decimal converted to strings. */
export function apiOk<T>(
  data: T,
  init: { status?: number; headers?: Record<string, string> } = {},
): NextResponse {
  return NextResponse.json(
    { data: serialize(data) },
    { status: init.status ?? 200, headers: init.headers },
  );
}

/** Maps any thrown value to a JSON error response. Unknown errors become a generic 500. */
export function apiError(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof AppError) {
    const headers: Record<string, string> = {};
    const retryAfter = error.details?.retryAfterSeconds;
    if (error.code === 'RATE_LIMITED' && typeof retryAfter === 'number')
      headers['retry-after'] = String(retryAfter);
    if (error.code === 'UNAUTHENTICATED') headers['www-authenticate'] = 'Bearer';
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fieldErrors ? { fields: error.fieldErrors } : {}),
        },
      },
      { status: error.status, headers },
    );
  }
  if (error instanceof z.ZodError) {
    const fields: Record<string, string[]> = {};
    for (const issue of error.issues)
      (fields[issue.path.join('.') || '_'] ??= []).push(issue.message);
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'Invalid request', fields } },
      { status: 400 },
    );
  }
  console.error('[api] unexpected error', error instanceof Error ? error.message : error);
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Internal server error' } },
    { status: 500 },
  );
}

/** Wraps a handler so thrown errors become JSON responses. */
export function apiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return apiError(error);
    }
  };
}

/** Parses a JSON body, throwing VALIDATION on malformed JSON or bodies over `maxBytes`. */
export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw new AppError('VALIDATION', 'Request body is too large');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('VALIDATION', 'Request body must be JSON');
  }
}

/** Binary download with safe headers (attachment, nosniff, private cache). */
export function fileResponse(
  data: Uint8Array,
  options: { contentType: string; fileName: string; inline?: boolean },
): Response {
  const safeName = options.fileName.replace(/[^A-Za-z0-9._-]/g, '_');
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'content-type': options.contentType,
      'content-length': String(data.byteLength),
      'content-disposition': `${options.inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
