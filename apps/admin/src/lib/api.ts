import {
  HTTP_HEADERS,
  type ApiErrorCode,
  type FieldError,
  type ProblemDetails,
  apiErrorResponseSchema,
  problemDetailsSchema,
} from '@bi-rem/shared';
import type { AdminUpdateUserDto, AssignRolesDto } from '@bi-rem/shared/schemas';
import type { z } from 'zod';

import { API } from '@/lib/routes';
import {
  type AdminCreateUserDto,
  type CreateApiKeyDto,
  type CreateRoleDto,
  type NotificationTemplateUpsertDto,
  type StatusReasonDto,
  type UpdateRoleDto,
  type UpsertFeatureFlagDto,
  type UpsertSettingDto,
  adminMeSchema,
  apiKeySchema,
  apiKeysListSchema,
  createdApiKeySchema,
  featureFlagSchema,
  featureFlagsListSchema,
  healthSchema,
  notificationTemplateSchema,
  paginatedAuditSchema,
  paginatedUsersSchema,
  permissionsListSchema,
  roleSchema,
  rolesListSchema,
  settingSchema,
  settingsListSchema,
  templatesListSchema,
  userProfileSchema,
  userRolesViewSchema,
} from '@/lib/schemas';

/**
 * Typed HTTP client for the BI-Rem API.
 *
 * Responsibilities:
 * - attaches `Authorization: Bearer <token>` from a pluggable {@link TokenProvider};
 * - on a 401 it asks the provider to refresh credentials once, then retries the request;
 * - maps RFC 9457 problem details (and the legacy `{ success: false, error }` envelope) to
 *   {@link ApiError}, so callers only ever deal with one error shape;
 * - optionally validates response bodies with a zod schema.
 *
 * The same class serves the browser (cookie-based, talking to the Next.js BFF routes) and the
 * server (route handlers forwarding to NestJS with cookies read from the request). The
 * resource-level wrappers in {@link createAdminApi} sit on top of it.
 */

export type ApiErrorKind = ApiErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'UNKNOWN_ERROR';

export interface ApiErrorInit {
  status: number;
  title: string;
  detail?: string;
  code?: ApiErrorKind;
  errors?: FieldError[];
  correlationId?: string;
  problem?: ProblemDetails;
  cause?: unknown;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly title: string;
  readonly detail: string | undefined;
  readonly code: ApiErrorKind;
  readonly errors: readonly FieldError[];
  readonly correlationId: string | undefined;
  readonly problem: ProblemDetails | undefined;

  constructor(init: ApiErrorInit) {
    super(init.detail ?? init.title, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.title = init.title;
    this.detail = init.detail;
    this.code = init.code ?? ApiError.codeFromStatus(init.status);
    this.errors = init.errors ?? [];
    this.correlationId = init.correlationId;
    this.problem = init.problem;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isValidation(): boolean {
    return this.status === 400 || this.status === 422 || this.code === 'VALIDATION_FAILED';
  }

  /** Field errors grouped by path, handy for `setError` in forms. */
  fieldErrors(): Record<string, string> {
    const grouped: Record<string, string> = {};
    for (const error of this.errors) {
      grouped[error.path] ??= error.message;
    }
    return grouped;
  }

  static codeFromStatus(status: number): ApiErrorKind {
    switch (status) {
      case 0:
        return 'NETWORK_ERROR';
      case 400:
      case 422:
        return 'VALIDATION_FAILED';
      case 401:
        return 'UNAUTHENTICATED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 429:
        return 'RATE_LIMITED';
      case 503:
        return 'SERVICE_UNAVAILABLE';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN_ERROR';
    }
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export interface TokenProvider {
  /** Current access token, or `null` when credentials travel some other way (cookies). */
  getAccessToken(): string | null | Promise<string | null>;
  /**
   * Called once after a 401. Must renew credentials (new token in memory, rotated cookies…) and
   * return `true` when the request should be retried.
   */
  refresh?(): Promise<boolean>;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Base URL, without trailing slash. `''` means same origin (browser → BFF). */
  baseUrl: string;
  fetch?: FetchLike;
  auth?: TokenProvider;
  credentials?: RequestCredentials;
  /** Extra headers merged into every request. */
  defaultHeaders?: Record<string, string>;
  /** Generates the `x-request-id` correlation id. Defaults to `crypto.randomUUID`. */
  requestId?: () => string;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions<TSchema extends z.ZodType = z.ZodType> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Validates the (unwrapped) response body; mismatches throw `INVALID_RESPONSE`. */
  schema?: TSchema;
  /** Skip the automatic refresh-and-retry on 401 (used for the auth endpoints themselves). */
  skipAuthRetry?: boolean;
}

export type GetOptions<TSchema extends z.ZodType = z.ZodType> = Omit<
  RequestOptions<TSchema>,
  'method' | 'body'
>;
export type BodyOptions<TSchema extends z.ZodType = z.ZodType> = Omit<
  RequestOptions<TSchema>,
  'method' | 'body'
>;

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

function defaultRequestId(): string {
  return crypto.randomUUID();
}

function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const text = await response.text();
  if (text.length === 0) return undefined;
  // Some servers omit the content type on error bodies; JSON is tried regardless.
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Builds an {@link ApiError} from a non-2xx response. Understands RFC 9457 problem details,
 * the `{ success: false, error }` envelope, and falls back to the HTTP status text.
 */
export async function toApiError(response: Response): Promise<ApiError> {
  const body = await readBody(response);
  const correlationId = response.headers.get(HTTP_HEADERS.requestId) ?? undefined;

  const problem = problemDetailsSchema.safeParse(body);
  if (problem.success) {
    return new ApiError({
      status: problem.data.status,
      title: problem.data.title,
      detail: problem.data.detail,
      code: problem.data.code,
      errors: problem.data.errors,
      correlationId: problem.data.correlationId ?? correlationId,
      problem: problem.data,
    });
  }

  const envelope = apiErrorResponseSchema.safeParse(body);
  if (envelope.success) {
    return new ApiError({
      status: response.status,
      title: envelope.data.error.message,
      detail: envelope.data.error.message,
      code: envelope.data.error.code,
      errors: envelope.data.error.details,
      correlationId: envelope.data.error.correlationId ?? correlationId,
    });
  }

  // NestJS default exception shape: { statusCode, message, error }.
  if (isRecord(body) && typeof body.message === 'string') {
    return new ApiError({
      status: response.status,
      title: typeof body.error === 'string' ? body.error : response.statusText || 'Request failed',
      detail: body.message,
      correlationId,
    });
  }

  return new ApiError({
    status: response.status,
    title: response.statusText || `HTTP ${response.status}`,
    detail: typeof body === 'string' && body.length < 500 ? body : undefined,
    correlationId,
  });
}

/** Unwraps the `{ success: true, data }` envelope when present; returns the body otherwise. */
export function unwrapData(body: unknown): unknown {
  if (isRecord(body) && body.success === true && 'data' in body) {
    return body.data;
  }
  return body;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly auth: TokenProvider | undefined;
  private readonly credentials: RequestCredentials | undefined;
  private readonly defaultHeaders: Record<string, string>;
  private readonly requestId: () => string;
  /** Shared across concurrent 401s so a burst of failures triggers a single refresh. */
  private refreshing: Promise<boolean> | null = null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.auth = options.auth;
    this.credentials = options.credentials;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.requestId = options.requestId ?? defaultRequestId;
  }

  /**
   * Performs the request and returns the raw `Response` (any status). Handles auth headers and
   * the single refresh-and-retry on 401. Network failures become `ApiError` with status 0.
   */
  async send(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = `${this.baseUrl}${path}${buildQuery(options.query)}`;
    const first = await this.dispatch(url, options);
    if (first.status !== 401 || options.skipAuthRetry || !this.auth?.refresh) {
      return first;
    }

    const refreshed = await this.refreshOnce();
    if (!refreshed) {
      return first;
    }
    // Drain the first body so the connection can be reused before retrying.
    await first.body?.cancel().catch(() => undefined);
    return this.dispatch(url, options);
  }

  /** Performs the request, maps errors and returns the parsed (and optionally validated) body. */
  async request<TSchema extends z.ZodType>(
    path: string,
    options: RequestOptions<TSchema> & { schema: TSchema },
  ): Promise<z.output<TSchema>>;
  async request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const response = await this.send(path, options);
    if (!response.ok) {
      throw await toApiError(response);
    }
    const data = unwrapData(await readBody(response));
    if (!options.schema) {
      return data;
    }
    const parsed = options.schema.safeParse(data);
    if (!parsed.success) {
      throw new ApiError({
        status: response.status,
        title: 'Unexpected response from the server',
        code: 'INVALID_RESPONSE',
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.') || '(root)',
          message: issue.message,
          code: issue.code,
        })),
        correlationId: response.headers.get(HTTP_HEADERS.requestId) ?? undefined,
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  get<TSchema extends z.ZodType>(
    path: string,
    options: GetOptions<TSchema> & { schema: TSchema },
  ): Promise<z.output<TSchema>>;
  get<T = unknown>(path: string, options?: GetOptions): Promise<T>;
  get(path: string, options: GetOptions = {}): Promise<unknown> {
    return this.request(path, { ...options, method: 'GET' });
  }

  post<TSchema extends z.ZodType>(
    path: string,
    body: unknown,
    options: BodyOptions<TSchema> & { schema: TSchema },
  ): Promise<z.output<TSchema>>;
  post<T = unknown>(path: string, body?: unknown, options?: BodyOptions): Promise<T>;
  post(path: string, body?: unknown, options: BodyOptions = {}): Promise<unknown> {
    return this.request(path, { ...options, method: 'POST', body });
  }

  put<TSchema extends z.ZodType>(
    path: string,
    body: unknown,
    options: BodyOptions<TSchema> & { schema: TSchema },
  ): Promise<z.output<TSchema>>;
  put<T = unknown>(path: string, body?: unknown, options?: BodyOptions): Promise<T>;
  put(path: string, body?: unknown, options: BodyOptions = {}): Promise<unknown> {
    return this.request(path, { ...options, method: 'PUT', body });
  }

  patch<TSchema extends z.ZodType>(
    path: string,
    body: unknown,
    options: BodyOptions<TSchema> & { schema: TSchema },
  ): Promise<z.output<TSchema>>;
  patch<T = unknown>(path: string, body?: unknown, options?: BodyOptions): Promise<T>;
  patch(path: string, body?: unknown, options: BodyOptions = {}): Promise<unknown> {
    return this.request(path, { ...options, method: 'PATCH', body });
  }

  delete<TSchema extends z.ZodType>(
    path: string,
    options: GetOptions<TSchema> & { schema: TSchema },
  ): Promise<z.output<TSchema>>;
  delete<T = unknown>(path: string, options?: GetOptions): Promise<T>;
  delete(path: string, options: GetOptions = {}): Promise<unknown> {
    return this.request(path, { ...options, method: 'DELETE' });
  }

  private async dispatch(url: string, options: RequestOptions): Promise<Response> {
    const headers = new Headers(this.defaultHeaders);
    headers.set('accept', `application/json, ${PROBLEM_CONTENT_TYPE}`);
    headers.set(HTTP_HEADERS.requestId, this.requestId());

    const token = await this.auth?.getAccessToken();
    if (token) headers.set('authorization', `Bearer ${token}`);

    for (const [key, value] of Object.entries(options.headers ?? {})) {
      headers.set(key, value);
    }

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(options.body);
    }

    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      cache: 'no-store',
    };
    if (body !== undefined) init.body = body;
    if (options.signal) init.signal = options.signal;
    if (this.credentials) init.credentials = this.credentials;

    try {
      return await this.fetchImpl(url, init);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw cause;
      }
      throw new ApiError({
        status: 0,
        title: 'Network error',
        detail: 'The server could not be reached. Check your connection and try again.',
        code: 'NETWORK_ERROR',
        cause,
      });
    }
  }

  private refreshOnce(): Promise<boolean> {
    if (!this.auth?.refresh) return Promise.resolve(false);
    this.refreshing ??= this.auth
      .refresh()
      .catch(() => false)
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
}

// --- Resource wrappers ------------------------------------------------------------------------

export interface ListUsersParams {
  page?: number;
  pageSize?: number;
  search?: string;
  realm?: string;
  status?: string;
}

/** Query parameters whitelisted by the API's `AuditQueryDto`. */
export interface AuditQueryParams {
  page?: number;
  pageSize?: number;
  actorId?: string;
  /** PascalCase entity name, e.g. `User`. */
  resource?: string;
  resourceId?: string;
  /** Dotted action name, e.g. `users.update`. */
  action?: string;
  outcome?: string;
  correlationId?: string;
  from?: string;
  to?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Typed, resource-oriented view of the admin API. Every method validates the response against
 * the wire schema so UI code never handles untyped JSON. Paths include the `/v1` prefix and are
 * relative to the client's base URL (the BFF proxy in the browser, the API on the server).
 */
export function createAdminApi(client: ApiClient) {
  return {
    client,
    health: {
      get: (signal?: AbortSignal) =>
        client.get(API.health, { schema: healthSchema, skipAuthRetry: true, signal }),
    },
    auth: {
      me: () => client.get(API.auth.me, { schema: adminMeSchema }),
    },
    users: {
      list: (params: ListUsersParams, signal?: AbortSignal) =>
        client.get(API.users.list, { query: { ...params }, schema: paginatedUsersSchema, signal }),
      get: (id: string, signal?: AbortSignal) =>
        client.get(API.users.byId(id), { schema: userProfileSchema, signal }),
      create: (dto: AdminCreateUserDto) =>
        client.post(API.users.create, dto, { schema: userProfileSchema }),
      update: (id: string, dto: AdminUpdateUserDto) =>
        client.patch(API.users.byId(id), dto, { schema: userProfileSchema }),
      suspend: (id: string, dto: StatusReasonDto) =>
        client.post(API.users.suspend(id), dto, { schema: userProfileSchema }),
      /** Reactivation also records a reason on the audit row (`StatusReasonDto`). */
      reactivate: (id: string, dto: StatusReasonDto) =>
        client.post(API.users.reactivate(id), dto, { schema: userProfileSchema }),
      /** Replaces the role set; answers with `{ userId, roles }`, not the profile. */
      assignRoles: (id: string, dto: AssignRolesDto) =>
        client.put(API.users.roles(id), dto, { schema: userRolesViewSchema }),
    },
    roles: {
      list: (signal?: AbortSignal) =>
        client.get(API.roles.list, { schema: rolesListSchema, signal }),
      create: (dto: CreateRoleDto) => client.post(API.roles.create, dto, { schema: roleSchema }),
      update: (id: string, dto: UpdateRoleDto) =>
        client.patch(API.roles.byId(id), dto, { schema: roleSchema }),
      remove: (id: string) => client.delete<void>(API.roles.byId(id)),
    },
    permissions: {
      list: (signal?: AbortSignal) =>
        client.get(API.permissions.list, { schema: permissionsListSchema, signal }),
    },
    audit: {
      list: (params: AuditQueryParams, signal?: AbortSignal) =>
        client.get(API.audit.list, { query: { ...params }, schema: paginatedAuditSchema, signal }),
    },
    featureFlags: {
      list: (signal?: AbortSignal) =>
        client.get(API.featureFlags.list, { schema: featureFlagsListSchema, signal }),
      /** Full replacement (`PUT`); callers merge the current flag with their change. */
      upsert: (key: string, dto: UpsertFeatureFlagDto) =>
        client.put(API.featureFlags.byKey(key), dto, { schema: featureFlagSchema }),
    },
    settings: {
      list: (signal?: AbortSignal) =>
        client.get(API.settings.list, { schema: settingsListSchema, signal }),
      upsert: (key: string, dto: UpsertSettingDto) =>
        client.put(API.settings.byKey(key), dto, { schema: settingSchema }),
    },
    apiKeys: {
      list: (signal?: AbortSignal) =>
        client.get(API.apiKeys.list, { schema: apiKeysListSchema, signal }),
      create: (dto: CreateApiKeyDto) =>
        client.post(API.apiKeys.create, dto, { schema: createdApiKeySchema }),
      /** Revocation answers 200 with the updated (revoked) key metadata. */
      revoke: (id: string) => client.delete(API.apiKeys.byId(id), { schema: apiKeySchema }),
    },
    templates: {
      list: (signal?: AbortSignal) =>
        client.get(API.notifications.templates, { schema: templatesListSchema, signal }),
      upsert: (dto: NotificationTemplateUpsertDto) =>
        client.put(API.notifications.templates, dto, { schema: notificationTemplateSchema }),
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
