import { describe, expect, it } from 'vitest';

import { diffJson, formatDiffValue, jsonEquals, summarizeDiff } from '@/lib/json-diff';

describe('diffJson', () => {
  it('reports changed, added, removed and unchanged leaves by path', () => {
    const entries = diffJson(
      { name: 'Ada', status: 'ACTIVE', phone: '+237600000000', roles: ['ADMIN'] },
      { name: 'Ada', status: 'SUSPENDED', locale: 'fr', roles: ['ADMIN', 'SUPPORT'] },
    );
    const byPath = Object.fromEntries(entries.map((entry) => [entry.path, entry]));

    expect(byPath.name?.kind).toBe('unchanged');
    expect(byPath.status).toMatchObject({ kind: 'changed', before: 'ACTIVE', after: 'SUSPENDED' });
    expect(byPath.phone).toMatchObject({ kind: 'removed', before: '+237600000000' });
    expect(byPath.locale).toMatchObject({ kind: 'added', after: 'fr' });
    expect(byPath['roles[0]']?.kind).toBe('unchanged');
    expect(byPath['roles[1]']).toMatchObject({ kind: 'added', after: 'SUPPORT' });
    expect(summarizeDiff(entries)).toEqual({ added: 2, removed: 1, changed: 1, unchanged: 2 });
  });

  it('recurses into nested objects and quotes non-identifier keys', () => {
    const entries = diffJson(
      { meta: { 'x-id': 1, inner: { a: 1 } } },
      { meta: { 'x-id': 2, inner: { a: 1 } } },
    );
    expect(entries.map((entry) => entry.path).sort()).toEqual(['meta.inner.a', 'meta["x-id"]']);
    expect(entries.find((entry) => entry.path === 'meta["x-id"]')?.kind).toBe('changed');
  });

  it('treats a missing before as everything added and a missing after as everything removed', () => {
    const created = diffJson(null, { id: '1', name: 'New' });
    expect(created.every((entry) => entry.kind === 'added')).toBe(true);
    expect(created).toHaveLength(2);

    const deleted = diffJson({ id: '1' }, undefined);
    expect(deleted).toEqual([{ path: 'id', kind: 'removed', before: '1', after: undefined }]);

    expect(diffJson(null, null)).toEqual([]);
  });

  it('handles scalar roots and type changes', () => {
    expect(diffJson(1, 2)).toEqual([{ path: '(root)', kind: 'changed', before: 1, after: 2 }]);
    expect(diffJson('a', 'a')[0]?.kind).toBe('unchanged');
    // Object replaced by a scalar is a single change at the root.
    expect(diffJson({ a: 1 }, 'gone')).toEqual([
      { path: '(root)', kind: 'changed', before: { a: 1 }, after: 'gone' },
    ]);
  });

  it('compares JSON values structurally', () => {
    expect(jsonEquals({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(jsonEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(jsonEquals([1, 2], [2, 1])).toBe(false);
    expect(jsonEquals(null, undefined)).toBe(false);
  });

  it('formats leaf values compactly', () => {
    expect(formatDiffValue(undefined)).toBe('—');
    expect(formatDiffValue(null)).toBe('null');
    expect(formatDiffValue('x')).toBe('"x"');
    expect(formatDiffValue(3)).toBe('3');
    expect(formatDiffValue({ a: 1 })).toBe('{"a":1}');
  });
});
