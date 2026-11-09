import { API_ROUTES } from '@bi-rem/shared/constants';

/**
 * API paths used by the customer portal, built on the shared `API_ROUTES` so they cannot drift
 * from the NestJS controllers. The self-service notification endpoints (`/notifications/me`,
 * `/notifications/me/:id/read`) are not part of the shared constants yet and are declared here
 * exactly as `NotificationsController` exposes them.
 */
export const API = {
  auth: {
    register: API_ROUTES.auth.register,
    login: API_ROUTES.auth.login,
    refresh: API_ROUTES.auth.refresh,
    logout: API_ROUTES.auth.logout,
    me: API_ROUTES.auth.me,
    passwordForgot: API_ROUTES.auth.passwordResetRequest,
    passwordReset: API_ROUTES.auth.passwordResetConfirm,
    passwordChange: API_ROUTES.auth.passwordChange,
  },
  users: {
    me: API_ROUTES.users.me,
  },
  notifications: {
    me: `${API_ROUTES.notifications.list}/me`,
    markRead: (id: string) => `${API_ROUTES.notifications.list}/me/${encodeURIComponent(id)}/read`,
  },
} as const;

/** Next.js route handlers (same-origin BFF) the browser talks to instead of the API directly. */
export const BFF = {
  auth: {
    login: '/api/auth/login',
    register: '/api/auth/register',
    logout: '/api/auth/logout',
    refresh: '/api/auth/refresh',
    forgotPassword: '/api/auth/password/forgot',
    resetPassword: '/api/auth/password/reset',
  },
  /** Prefix under which authenticated API calls are forwarded with the access-token cookie. */
  proxy: '/api/proxy',
} as const;

/** Portal pages, typed so redirects and links never drift from the file-system routes. */
export const PAGES = {
  home: '/',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  dashboard: '/dashboard',
  profile: '/profile',
  notifications: '/notifications',
  security: '/security',
} as const;

export type PagePath = (typeof PAGES)[keyof typeof PAGES];

const PROTECTED_PREFIXES: readonly string[] = [
  PAGES.dashboard,
  PAGES.profile,
  PAGES.notifications,
  PAGES.security,
];

const AUTH_PAGES: readonly string[] = [
  PAGES.login,
  PAGES.register,
  PAGES.forgotPassword,
  PAGES.resetPassword,
];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.includes(pathname);
}

/**
 * Validates a post-login redirect target: only same-origin absolute paths are accepted, so an
 * attacker cannot bounce users to an external site through `?next=`. Route handlers and Next
 * internals are excluded as well, since landing there after login makes no sense.
 */
export function safeNextPath(
  candidate: string | null | undefined,
  fallback: string = PAGES.dashboard,
): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return fallback;
  }
  if (/[\\\r\n\0]/.test(candidate)) return fallback;
  if (candidate.startsWith('/api/') || candidate.startsWith('/_next/')) return fallback;
  return candidate;
}
