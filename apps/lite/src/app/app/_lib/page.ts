import 'server-only';

import { notFound } from 'next/navigation';
import { z } from 'zod';

import { AppError } from '@/server/errors';

/** Helpers for customer pages: map "not yours / not there" to the 404 page, parse params. */

const uuid = z.uuid();

/** A dynamic segment that must be a UUID; anything else is a 404 (never a database error). */
export function uuidParam(value: string | undefined): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) notFound();
  return parsed.data;
}

/**
 * Runs a service call and turns `NOT_FOUND` into the 404 page. Services answer NOT_FOUND for
 * objects the customer does not own, so "someone else's transfer" and "no such transfer" look
 * exactly the same.
 */
export async function orNotFound<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
}

/** First value of a search parameter (Next gives `string | string[] | undefined`). */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Flattens Next search params to single strings, dropping empty values. */
export async function readSearchParams(
  searchParams: SearchParams,
): Promise<Record<string, string>> {
  const raw = await searchParams;
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const first = firstParam(value)?.trim();
    if (first) flat[key] = first;
  }
  return flat;
}
