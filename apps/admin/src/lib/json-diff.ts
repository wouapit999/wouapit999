/**
 * Structural diff between the `before` and `after` snapshots stored on audit log rows. Produces a
 * flat list of leaf-level changes keyed by JSON path, which is what the audit viewer renders.
 */

export type DiffKind = 'added' | 'removed' | 'changed' | 'unchanged';

export interface DiffEntry {
  /** Dot/bracket path from the root, e.g. `roles[1].name`; `(root)` for scalar roots. */
  path: string;
  kind: DiffKind;
  before: unknown;
  after: unknown;
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function joinPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  if (parent === '') return key;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

/** Deep structural equality for JSON-like values (order-sensitive for arrays, not for objects). */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonEquals(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => Object.hasOwn(b, key) && jsonEquals(a[key], b[key]));
  }
  return false;
}

function walk(before: unknown, after: unknown, path: string, out: DiffEntry[]): void {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      const childPath = joinPath(path, key);
      const inBefore = Object.hasOwn(before, key);
      const inAfter = Object.hasOwn(after, key);
      if (inBefore && !inAfter) {
        out.push({ path: childPath, kind: 'removed', before: before[key], after: undefined });
      } else if (!inBefore && inAfter) {
        out.push({ path: childPath, kind: 'added', before: undefined, after: after[key] });
      } else {
        walk(before[key], after[key], childPath, out);
      }
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const childPath = joinPath(path, index);
      if (index >= before.length) {
        out.push({ path: childPath, kind: 'added', before: undefined, after: after[index] });
      } else if (index >= after.length) {
        out.push({ path: childPath, kind: 'removed', before: before[index], after: undefined });
      } else {
        walk(before[index], after[index], childPath, out);
      }
    }
    return;
  }

  out.push({
    path: path === '' ? '(root)' : path,
    kind: jsonEquals(before, after) ? 'unchanged' : 'changed',
    before,
    after,
  });
}

/**
 * Diffs two JSON values. `null`/`undefined` on one side (e.g. a `create` audit row has no
 * `before`) is treated as "everything added"/"everything removed" rather than as a scalar change.
 */
export function diffJson(before: unknown, after: unknown): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const beforeMissing = before === null || before === undefined;
  const afterMissing = after === null || after === undefined;

  if (beforeMissing && afterMissing) return entries;

  if (beforeMissing && (isPlainObject(after) || Array.isArray(after))) {
    walk(Array.isArray(after) ? [] : {}, after, '', entries);
    return entries;
  }
  if (afterMissing && (isPlainObject(before) || Array.isArray(before))) {
    walk(before, Array.isArray(before) ? [] : {}, '', entries);
    return entries;
  }

  walk(before, after, '', entries);
  return entries;
}

export function summarizeDiff(entries: readonly DiffEntry[]): DiffSummary {
  const summary: DiffSummary = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const entry of entries) summary[entry.kind] += 1;
  return summary;
}

/** Stable, compact rendering of a leaf value for the diff table. */
export function formatDiffValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}
