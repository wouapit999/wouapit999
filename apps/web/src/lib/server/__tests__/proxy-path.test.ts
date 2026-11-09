// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { resolveProxyPath } from '@/lib/server/proxy-path';

describe('resolveProxyPath', () => {
  it('forwards well-formed versioned paths, re-encoding each segment', () => {
    expect(resolveProxyPath(['v1', 'users', 'me'])).toEqual({ ok: true, path: '/v1/users/me' });
    expect(
      resolveProxyPath([
        'v1',
        'notifications',
        'me',
        '8a1f2c3d-0000-4000-8000-000000000000',
        'read',
      ]),
    ).toEqual({ ok: true, path: '/v1/notifications/me/8a1f2c3d-0000-4000-8000-000000000000/read' });
    expect(resolveProxyPath(['v1', 'settings', 'auth.password%2Dpolicy'])).toEqual({
      ok: true,
      path: '/v1/settings/auth.password-policy',
    });
  });

  it('rejects anything outside /v1 and the session endpoints owned by /api/auth', () => {
    expect(resolveProxyPath(['health'])).toEqual({ ok: false });
    expect(resolveProxyPath(['v1'])).toEqual({ ok: false });
    expect(resolveProxyPath(['v2', 'users'])).toEqual({ ok: false });
    for (const blocked of [
      ['v1', 'auth', 'login'],
      ['v1', 'auth', 'refresh'],
      ['v1', 'auth', 'logout'],
      ['v1', 'auth', 'register'],
      ['v1', 'auth', 'password', 'reset', 'confirm'],
    ]) {
      expect(resolveProxyPath(blocked), blocked.join('/')).toEqual({ ok: false });
    }
    // The authenticated password change is legitimately proxied.
    expect(resolveProxyPath(['v1', 'auth', 'password', 'change']).ok).toBe(true);
  });

  it('rejects traversal, query/fragment smuggling and malformed encodings', () => {
    expect(resolveProxyPath(['v1', '..', 'admin'])).toEqual({ ok: false });
    expect(resolveProxyPath(['v1', 'users%2F..%2Fadmin'])).toEqual({ ok: false });
    expect(resolveProxyPath(['v1', 'users%3Fid%3D1'])).toEqual({ ok: false });
    expect(resolveProxyPath(['v1', 'users%23frag'])).toEqual({ ok: false });
    expect(resolveProxyPath(['v1', 'users', ''])).toEqual({ ok: false });
    expect(resolveProxyPath(['v1', '%E0%A4%A'])).toEqual({ ok: false });
    expect(resolveProxyPath(['v1', 'http://evil.example'])).toEqual({ ok: false });
    expect(resolveProxyPath(['v1', ...Array.from({ length: 20 }, () => 'a')])).toEqual({
      ok: false,
    });
  });
});
