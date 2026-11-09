// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { API_ROUTES } from '@bi-rem/shared/constants';

import { API, PAGES, isAuthPage, isProtectedPath, safeNextPath } from '@/lib/routes';

describe('API paths', () => {
  it('match the NestJS controllers (AuthController, NotificationsController, UsersController)', () => {
    expect(API.auth.login).toBe('/v1/auth/login');
    expect(API.auth.me).toBe('/v1/auth/me');
    expect(API.auth.passwordForgot).toBe('/v1/auth/password/reset/request');
    expect(API.auth.passwordReset).toBe('/v1/auth/password/reset/confirm');
    expect(API.auth.passwordChange).toBe('/v1/auth/password/change');
    expect(API.users.me).toBe('/v1/users/me');
    expect(API.notifications.me).toBe('/v1/notifications/me');
    expect(API.notifications.markRead('abc/../x')).toBe('/v1/notifications/me/abc%2F..%2Fx/read');
  });

  it('reuse the shared constants where they exist', () => {
    expect(API.auth.passwordForgot).toBe(API_ROUTES.auth.passwordResetRequest);
    expect(API.auth.passwordReset).toBe(API_ROUTES.auth.passwordResetConfirm);
    expect(API.auth.refresh).toBe(API_ROUTES.auth.refresh);
  });
});

describe('route classification', () => {
  it('protects the dashboard tree and recognises auth pages', () => {
    expect(isProtectedPath(PAGES.dashboard)).toBe(true);
    expect(isProtectedPath('/profile/edit')).toBe(true);
    expect(isProtectedPath('/profiles')).toBe(false);
    expect(isProtectedPath(PAGES.login)).toBe(false);
    expect(isAuthPage(PAGES.register)).toBe(true);
    expect(isAuthPage('/register/x')).toBe(false);
  });
});

describe('safeNextPath', () => {
  it('accepts same-origin absolute paths', () => {
    expect(safeNextPath('/notifications?page=2')).toBe('/notifications?page=2');
    expect(safeNextPath('/profile#top')).toBe('/profile#top');
  });

  it('falls back for external, protocol-relative, backslash and control-character targets', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/profile\\..',
      '/profile\r\nSet-Cookie: x=y',
      'profile',
      '',
      null,
      undefined,
    ]) {
      expect(safeNextPath(bad), String(bad)).toBe(PAGES.dashboard);
    }
  });

  it('never lands on route handlers or Next internals', () => {
    expect(safeNextPath('/api/auth/logout')).toBe(PAGES.dashboard);
    expect(safeNextPath('/_next/static/x')).toBe(PAGES.dashboard);
    expect(safeNextPath('/api/auth/logout', PAGES.login)).toBe(PAGES.login);
  });
});
