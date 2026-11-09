import { describe, expect, it } from 'vitest';

import { API, PAGES, isAuthPage, isProtectedPath, safeNextPath } from '@/lib/routes';

describe('routes', () => {
  it('builds admin-specific API paths on the shared /v1 prefix', () => {
    expect(API.auth.adminLogin).toBe('/v1/auth/admin/login');
    expect(API.users.suspend('abc')).toBe('/v1/users/abc/suspend');
    expect(API.users.reactivate('a/b')).toBe('/v1/users/a%2Fb/reactivate');
    expect(API.featureFlags.byKey('auth.mfa.totp')).toBe('/v1/feature-flags/auth.mfa.totp');
    expect(API.settings.byKey('platform.name')).toBe('/v1/settings/platform.name');
    expect(API.health).toBe('/health');
  });

  it('recognises protected and auth pages', () => {
    expect(isProtectedPath(PAGES.dashboard)).toBe(true);
    expect(isProtectedPath('/users/123')).toBe(true);
    expect(isProtectedPath('/notifications/templates')).toBe(true);
    expect(isProtectedPath('/usersx')).toBe(false);
    expect(isProtectedPath(PAGES.login)).toBe(false);
    expect(isAuthPage(PAGES.login)).toBe(true);
  });

  it('only accepts same-origin page paths as redirect targets', () => {
    expect(safeNextPath('/users?page=2')).toBe('/users?page=2');
    expect(safeNextPath('https://evil.example')).toBe(PAGES.dashboard);
    expect(safeNextPath('//evil.example')).toBe(PAGES.dashboard);
    expect(safeNextPath('/api/auth/logout')).toBe(PAGES.dashboard);
    expect(safeNextPath('/\\evil')).toBe(PAGES.dashboard);
    expect(safeNextPath('/users\r\nSet-Cookie: x=y')).toBe(PAGES.dashboard);
    expect(safeNextPath('/_next/static/chunk.js')).toBe(PAGES.dashboard);
    expect(safeNextPath(null, PAGES.users)).toBe(PAGES.users);
  });
});
