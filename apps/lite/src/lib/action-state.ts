/**
 * State returned by every server action built with `createAction` and consumed by
 * `<ActionForm>` (`useActionState`). Safe to import from Client Components.
 */
export interface ActionState<T = unknown> {
  /** True after a successful run. */
  readonly ok: boolean;
  /** Human message: the error, or the success confirmation. */
  readonly message?: string;
  /** Per-field validation messages, keyed by the form field name. */
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  /** Echo of the submitted (non-sensitive) values so the form keeps them after an error. */
  readonly values?: Readonly<Record<string, string>>;
  /** Serialised result of the handler (bigint/Date already converted to strings). */
  readonly data?: T;
}

export const initialActionState: ActionState<never> = { ok: false };
