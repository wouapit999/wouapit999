import { type ActionState, initialActionState } from '@/lib/action-state';
import type { Serialized } from '@/server/money';

/**
 * Client-side glue for server actions built with `createAction`.
 *
 * `createAction` returns its result through `serialize()` (bigint / Date → string) but keeps the
 * handler's un-serialised type. These helpers restore the truth for the compiler, so Client
 * Components read `state.data.amount` as the string it really is.
 */

export type SerializedAction<T> = (
  previous: ActionState<Serialized<T>>,
  formData: FormData,
) => Promise<ActionState<Serialized<T>>>;

/** The data a `createAction` action delivers to the browser: `ActionData<typeof someAction>`. */
export type ActionData<Action> = Action extends (
  previous: ActionState<infer T>,
  formData: FormData,
) => unknown
  ? Serialized<T>
  : never;

/** First message per field, plus the form-level message, from a failed action state. */
export function errorsOf(state: ActionState<unknown>): {
  message: string | undefined;
  fields: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  for (const [name, messages] of Object.entries(state.fieldErrors ?? {})) {
    const [first] = messages;
    if (first) fields[name] = first;
  }
  return { message: state.ok ? undefined : state.message, fields };
}

/** Re-types a `createAction` action to what actually crosses the wire. Same function reference. */
export function asSerialized<T>(
  action: (previous: ActionState<T>, formData: FormData) => Promise<ActionState<T>>,
): SerializedAction<T> {
  return action as unknown as SerializedAction<T>;
}

/** Builds a `FormData` from plain fields, skipping undefined / null / empty values. */
export function toFormData(fields: Readonly<Record<string, string | null | undefined>>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== '') formData.set(key, value);
  }
  return formData;
}

/**
 * Calls a `createAction` action outside a `<form>` (live quotes while typing, wizard steps).
 * The action still authenticates, authorises and validates on the server like any form post.
 * A network failure is reported as a failed state instead of an exception.
 */
export async function callAction<T>(
  action: (previous: ActionState<T>, formData: FormData) => Promise<ActionState<T>>,
  fields: Readonly<Record<string, string | null | undefined>>,
): Promise<ActionState<Serialized<T>>> {
  try {
    return await asSerialized(action)(initialActionState, toFormData(fields));
  } catch {
    return {
      ok: false,
      message: 'We could not reach the server. Check your connection and try again.',
    };
  }
}
