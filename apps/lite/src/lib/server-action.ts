import 'server-only';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import type { Role } from '@/generated/prisma/enums';
import type { RequestMeta } from '@/server/auth';
import { getActionContext, getRequestMeta } from '@/server/auth/session';
import { AppError } from '@/server/errors';
import { serialize } from '@/server/money';
import { type ActionContext, type Permission, hasPermission } from '@/server/rbac';

import type { ActionState } from './action-state';

/**
 * Factory for server actions used with `<ActionForm>` / `useActionState`.
 *
 * Every action built here: (1) authenticates from the session cookie, (2) checks role and/or
 * permission server-side, (3) validates the form with Zod and returns per-field errors,
 * (4) runs the handler — services in `@/server/**` re-check authorisation and write the audit
 * row — and (5) maps `AppError` to a friendly message instead of crashing the page.
 */

/** Fields never echoed back to the browser after a failed submit. */
const SENSITIVE_FIELD = /pass|secret|token|credential|otp|apikey|^code$/i;

/** `FormData` → plain object. Repeated keys and keys ending in `[]` become arrays; files stay `File`s. */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const rawKey of new Set(formData.keys())) {
    if (rawKey.startsWith('$ACTION_')) continue;
    const values = formData
      .getAll(rawKey)
      .map((value) => (typeof value === 'string' ? value.trim() : value));
    const isArray = rawKey.endsWith('[]');
    const key = isArray ? rawKey.slice(0, -2) : rawKey;
    if (isArray || values.length > 1) {
      result[key] = values.filter((value) => value !== '');
    } else {
      const [value] = values;
      // Empty text inputs and empty file inputs mean "not provided".
      const empty =
        value === '' || (value instanceof File && value.size === 0 && value.name === '');
      if (!empty) result[key] = value;
    }
  }
  return result;
}

function echoValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string' || key.startsWith('$ACTION_') || SENSITIVE_FIELD.test(key))
      continue;
    if (value.length <= 2000) values[key] = value;
  }
  return values;
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : '_form';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

function failure<T>(error: unknown, formData: FormData): ActionState<T> {
  const values = echoValues(formData);
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      message: 'Please check the highlighted fields.',
      fieldErrors: fieldErrorsFrom(error),
      values,
    };
  }
  if (error instanceof AppError) {
    return { ok: false, message: error.message, fieldErrors: error.fieldErrors, values };
  }
  console.error('[action] unexpected error', error instanceof Error ? error.message : error);
  return { ok: false, message: 'Something went wrong on our side. Please try again.', values };
}

interface CommonOptions<Schema extends z.ZodType, Result> {
  /** Validates the object produced by `formDataToObject`. */
  readonly schema: Schema;
  /** Message shown on success (ignored when `redirectTo` is set). */
  readonly successMessage?: string | ((result: Result) => string);
  /** Paths to revalidate after success. */
  readonly revalidate?: readonly string[] | ((result: Result) => readonly string[]);
  /** Redirect after success (runs outside the try/catch, as Next.js requires). */
  readonly redirectTo?: string | ((result: Result) => string);
}

export interface ActionOptions<Schema extends z.ZodType, Result> extends CommonOptions<
  Schema,
  Result
> {
  /** Roles allowed to run the action. */
  readonly roles?: readonly Role[];
  /** Permission required to run the action. */
  readonly permission?: Permission;
  readonly handler: (
    input: z.output<Schema>,
    ctx: ActionContext,
    formData: FormData,
  ) => Promise<Result>;
}

export type FormAction<Result> = (
  previous: ActionState<Result>,
  formData: FormData,
) => Promise<ActionState<Result>>;

async function finish<Schema extends z.ZodType, Result>(
  options: CommonOptions<Schema, Result>,
  result: Result,
): Promise<ActionState<Result>> {
  const paths =
    typeof options.revalidate === 'function'
      ? options.revalidate(result)
      : (options.revalidate ?? []);
  for (const path of paths) revalidatePath(path);
  if (options.redirectTo) {
    redirect(
      typeof options.redirectTo === 'function' ? options.redirectTo(result) : options.redirectTo,
    );
  }
  const message =
    typeof options.successMessage === 'function'
      ? options.successMessage(result)
      : options.successMessage;
  return Promise.resolve({ ok: true, message, data: serialize(result) as Result });
}

/**
 * Authenticated server action. Usage (in a `'use server'` file):
 *
 *   export const renameBeneficiaryAction = createAction({
 *     schema: z.object({ id: z.uuid(), fullName: z.string().min(2) }),
 *     roles: ['CUSTOMER'],
 *     handler: (input, ctx) => updateBeneficiary(ctx, input.id, { fullName: input.fullName }),
 *     successMessage: 'Beneficiary updated',
 *     revalidate: ['/app/beneficiaries'],
 *   });
 */
export function createAction<Schema extends z.ZodType, Result = void>(
  options: ActionOptions<Schema, Result>,
): FormAction<Result> {
  return async (_previous, formData) => {
    let result: Result;
    try {
      const ctx = await getActionContext();
      if (ctx.actor.type !== 'USER') throw new AppError('FORBIDDEN', 'Not allowed');
      if (options.roles && !options.roles.includes(ctx.actor.role)) {
        throw new AppError('FORBIDDEN', 'You are not allowed to do this');
      }
      if (options.permission && !hasPermission(ctx, options.permission)) {
        throw new AppError('FORBIDDEN', 'You are not allowed to do this');
      }
      const input = options.schema.parse(formDataToObject(formData));
      result = await options.handler(input, ctx, formData);
    } catch (error) {
      return failure(error, formData);
    }
    return finish(options, result);
  };
}

export interface PublicActionOptions<Schema extends z.ZodType, Result> extends CommonOptions<
  Schema,
  Result
> {
  readonly handler: (
    input: z.output<Schema>,
    meta: Required<RequestMeta>,
    formData: FormData,
  ) => Promise<Result>;
}

/** Server action for signed-out visitors (login, registration, partner application). */
export function createPublicAction<Schema extends z.ZodType, Result = void>(
  options: PublicActionOptions<Schema, Result>,
): FormAction<Result> {
  return async (_previous, formData) => {
    let result: Result;
    try {
      const input = options.schema.parse(formDataToObject(formData));
      result = await options.handler(input, await getRequestMeta(), formData);
    } catch (error) {
      return failure(error, formData);
    }
    return finish(options, result);
  };
}
