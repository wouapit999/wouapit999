import { API_ROUTES, OPS_ROUTES } from '@bi-rem/shared/constants';

/**
 * API paths used by the admin portal. Shared routes are reused where the Phase 1 contract
 * matches; admin-specific endpoints (`/auth/admin/login`, suspend/reactivate, the audit query
 * parameter names) follow the contract handed to this portal and live here so a contract change
 * is a one-line fix.
 */
export const API = {
  health: OPS_ROUTES.health,
  auth: {
    adminLogin: '/v1/auth/admin/login',
    refresh: API_ROUTES.auth.refresh,
    logout: API_ROUTES.auth.logout,
    me: API_ROUTES.auth.me,
  },
  users: {
    list: API_ROUTES.users.list,
    create: API_ROUTES.users.create,
    byId: API_ROUTES.users.byId,
    roles: API_ROUTES.users.roles,
    suspend: (id: string) => `${API_ROUTES.users.byId(id)}/suspend`,
    reactivate: (id: string) => `${API_ROUTES.users.byId(id)}/reactivate`,
  },
  roles: API_ROUTES.roles,
  permissions: API_ROUTES.permissions,
  audit: { list: API_ROUTES.audit.list },
  featureFlags: {
    list: API_ROUTES.featureFlags.list,
    byKey: API_ROUTES.featureFlags.byKey,
  },
  settings: { list: API_ROUTES.settings.list, byKey: API_ROUTES.settings.byKey },
  apiKeys: {
    list: API_ROUTES.apiKeys.list,
    create: API_ROUTES.apiKeys.create,
    byId: API_ROUTES.apiKeys.byId,
  },
  notifications: {
    templates: API_ROUTES.notifications.templates,
  },
} as const;

/** Next.js route handlers (same-origin BFF) the browser talks to instead of the API directly. */
export const BFF = {
  auth: {
    login: '/api/auth/login',
    logout: '/api/auth/logout',
    refresh: '/api/auth/refresh',
  },
  /** Prefix under which authenticated API calls are forwarded with the access-token cookie. */
  proxy: '/api/proxy',
} as const;

/** Portal pages, typed so redirects and links never drift from the file-system routes. */
export const PAGES = {
  home: '/',
  login: '/login',
  dashboard: '/dashboard',
  users: '/users',
  user: (id: string) => `/users/${encodeURIComponent(id)}`,
  roles: '/roles',
  audit: '/audit',
  templates: '/notifications/templates',
  settings: '/settings',
} as const;

const PROTECTED_PREFIXES: readonly string[] = [
  PAGES.dashboard,
  PAGES.users,
  PAGES.roles,
  PAGES.audit,
  '/notifications',
  PAGES.settings,
];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isAuthPage(pathname: string): boolean {
  return pathname === PAGES.login;
}

/**
 * Validates a post-login redirect target: only same-origin absolute paths are accepted, so an
 * attacker cannot bounce users to an external site through `?next=`.
 */
export function safeNextPath(
  candidate: string | null | undefined,
  fallback: string = PAGES.dashboard,
): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return fallback;
  }
  // Control characters have no place in a Location header; `/_next/` is framework internals.
  if (/[\r\n\0]/.test(candidate)) return fallback;
  if (candidate.startsWith('/api/') || candidate.startsWith('/_next/')) return fallback;
  return candidate;
}
