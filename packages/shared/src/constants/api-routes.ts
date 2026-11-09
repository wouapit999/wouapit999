/** Global API prefix applied by the NestJS app (`app.setGlobalPrefix`). */
export const API_PREFIX = '/v1';

/** Unprefixed operational endpoints. */
export const OPS_ROUTES = {
  health: '/health',
  healthLive: '/health/live',
  healthReady: '/health/ready',
  metrics: '/metrics',
  docs: '/docs',
  openApiJson: '/docs-json',
} as const;

const v1 = (path: string): string => `${API_PREFIX}${path}`;

/**
 * Absolute request paths (prefix included) shared by the API e2e tests and the portal clients.
 * Functions build paths that embed identifiers; values are plain strings otherwise.
 */
export const API_ROUTES = {
  auth: {
    register: v1('/auth/register'),
    login: v1('/auth/login'),
    refresh: v1('/auth/refresh'),
    logout: v1('/auth/logout'),
    me: v1('/auth/me'),
    mfaSetup: v1('/auth/mfa/setup'),
    mfaEnable: v1('/auth/mfa/enable'),
    mfaDisable: v1('/auth/mfa/disable'),
    mfaVerify: v1('/auth/mfa/verify'),
    passwordResetRequest: v1('/auth/password/reset/request'),
    passwordResetConfirm: v1('/auth/password/reset/confirm'),
    passwordChange: v1('/auth/password/change'),
    verifyEmail: v1('/auth/verify-email'),
  },
  users: {
    list: v1('/users'),
    create: v1('/users'),
    me: v1('/users/me'),
    byId: (id: string) => v1(`/users/${encodeURIComponent(id)}`),
    roles: (id: string) => v1(`/users/${encodeURIComponent(id)}/roles`),
    status: (id: string) => v1(`/users/${encodeURIComponent(id)}/status`),
  },
  roles: {
    list: v1('/roles'),
    create: v1('/roles'),
    byId: (id: string) => v1(`/roles/${encodeURIComponent(id)}`),
  },
  permissions: {
    list: v1('/permissions'),
  },
  audit: {
    list: v1('/audit'),
    byId: (id: string) => v1(`/audit/${encodeURIComponent(id)}`),
    export: v1('/audit/export'),
  },
  notifications: {
    list: v1('/notifications'),
    byId: (id: string) => v1(`/notifications/${encodeURIComponent(id)}`),
    markRead: (id: string) => v1(`/notifications/${encodeURIComponent(id)}/read`),
    preferences: v1('/notifications/preferences'),
    templates: v1('/notifications/templates'),
    templateByKey: (key: string) => v1(`/notifications/templates/${encodeURIComponent(key)}`),
  },
  featureFlags: {
    list: v1('/feature-flags'),
    byKey: (key: string) => v1(`/feature-flags/${encodeURIComponent(key)}`),
    evaluate: v1('/feature-flags/evaluate'),
  },
  settings: {
    list: v1('/settings'),
    byKey: (key: string) => v1(`/settings/${encodeURIComponent(key)}`),
  },
  apiKeys: {
    list: v1('/api-keys'),
    create: v1('/api-keys'),
    byId: (id: string) => v1(`/api-keys/${encodeURIComponent(id)}`),
    rotate: (id: string) => v1(`/api-keys/${encodeURIComponent(id)}/rotate`),
  },
} as const;

/** HTTP header names used across services. */
export const HTTP_HEADERS = {
  requestId: 'x-request-id',
  apiKey: 'x-api-key',
  realm: 'x-bi-rem-realm',
  locale: 'accept-language',
  idempotencyKey: 'idempotency-key',
} as const;

/** Default pagination bounds enforced by list endpoints. */
export const PAGINATION = {
  defaultPage: 1,
  defaultPageSize: 20,
  maxPageSize: 100,
} as const;
