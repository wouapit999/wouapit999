// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiClient, ApiError, type FetchLike, createAdminApi, toApiError } from '@/lib/api';

function jsonResponse(body: unknown, init: ResponseInit & { contentType?: string } = {}): Response {
  const { contentType = 'application/json', ...rest } = init;
  return new Response(JSON.stringify(body), {
    status: 200,
    ...rest,
    headers: { 'content-type': contentType, ...(rest.headers ?? {}) },
  });
}

function problemResponse(status: number, extra: Record<string, unknown> = {}): Response {
  return jsonResponse(
    { type: 'about:blank', title: 'Unauthorized', status, ...extra },
    { status, contentType: 'application/problem+json' },
  );
}

describe('ApiClient', () => {
  it('attaches the bearer token, accept and request id headers and drops empty query values', async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ id: 1 }));
    const client = new ApiClient({
      baseUrl: 'https://api.test/',
      fetch: fetchMock,
      auth: { getAccessToken: () => 'token-1' },
      requestId: () => 'req-123',
    });

    await expect(
      client.get('/v1/users', { query: { page: 2, search: '', realm: undefined, status: null } }),
    ).resolves.toEqual({ id: 1 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/users?page=2');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer token-1');
    expect(headers.get('x-request-id')).toBe('req-123');
    expect(headers.get('accept')).toContain('application/problem+json');
    expect(init?.cache).toBe('no-store');
  });

  it('serialises JSON bodies and unwraps the success envelope', async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        success: true,
        data: { ok: true },
        meta: { correlationId: 'c', timestamp: 'now' },
      }),
    );
    const client = new ApiClient({ baseUrl: '', fetch: fetchMock });

    await expect(client.put('/v1/settings', { key: 'a' })).resolves.toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(JSON.stringify({ key: 'a' }));
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    let token = 'expired';
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(problemResponse(401, { code: 'TOKEN_EXPIRED' }))
      .mockResolvedValueOnce(jsonResponse({ email: 'a@b.c' }));
    const refresh = vi.fn(() => {
      token = 'fresh';
      return Promise.resolve(true);
    });
    const client = new ApiClient({
      baseUrl: 'https://api.test',
      fetch: fetchMock,
      auth: { getAccessToken: () => token, refresh },
    });

    await expect(client.get('/v1/auth/me')).resolves.toEqual({ email: 'a@b.c' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('authorization')).toBe(
      'Bearer expired',
    );
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get('authorization')).toBe(
      'Bearer fresh',
    );
  });

  it('surfaces the original 401 when the refresh fails', async () => {
    const fetchMock = vi
      .fn<FetchLike>()
      .mockResolvedValue(problemResponse(401, { code: 'TOKEN_REVOKED' }));
    const refresh = vi.fn(() => Promise.resolve(false));
    const client = new ApiClient({
      baseUrl: '',
      fetch: fetchMock,
      auth: { getAccessToken: () => 't', refresh },
    });

    const error = await client.get('/v1/auth/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).code).toBe('TOKEN_REVOKED');
    expect((error as ApiError).isUnauthorized).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never refreshes more than once per request, even if the retry is also a 401', async () => {
    const fetchMock = vi.fn<FetchLike>(() => Promise.resolve(problemResponse(401)));
    const refresh = vi.fn(() => Promise.resolve(true));
    const client = new ApiClient({
      baseUrl: '',
      fetch: fetchMock,
      auth: { getAccessToken: () => 't', refresh },
    });

    await expect(client.get('/v1/x')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent 401s into a single refresh', async () => {
    const fetchMock = vi.fn<FetchLike>((_url, init) => {
      const auth = new Headers(init?.headers).get('authorization');
      return Promise.resolve(
        auth === 'Bearer fresh' ? jsonResponse({ ok: true }) : problemResponse(401),
      );
    });
    let token = 'stale';
    let resolveRefresh: (value: boolean) => void = () => undefined;
    const refresh = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRefresh = (value) => {
            token = 'fresh';
            resolve(value);
          };
        }),
    );
    const client = new ApiClient({
      baseUrl: '',
      fetch: fetchMock,
      auth: { getAccessToken: () => token, refresh },
    });

    const pending = Promise.all([client.get('/v1/a'), client.get('/v1/b')]);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    resolveRefresh(true);

    await expect(pending).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('skips the refresh flow when skipAuthRetry is set', async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(problemResponse(401));
    const refresh = vi.fn(() => Promise.resolve(true));
    const client = new ApiClient({
      baseUrl: '',
      fetch: fetchMock,
      auth: { getAccessToken: () => 't', refresh },
    });

    await expect(
      client.post('/v1/auth/admin/login', {}, { skipAuthRetry: true }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('maps RFC 9457 problem details, including field errors and correlation id', async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(
      problemResponse(422, {
        title: 'Validation failed',
        detail: 'One or more fields are invalid',
        code: 'VALIDATION_FAILED',
        errors: [{ path: 'email', message: 'Invalid email address' }],
        correlationId: 'corr-1',
      }),
    );
    const client = new ApiClient({ baseUrl: '', fetch: fetchMock });

    const error = (await client.post('/v1/users', {}).catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(422);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe('One or more fields are invalid');
    expect(error.correlationId).toBe('corr-1');
    expect(error.fieldErrors()).toEqual({ email: 'Invalid email address' });
    expect(error.isValidation).toBe(true);
  });

  it('maps the legacy error envelope, plain Nest errors and text bodies', async () => {
    const envelope = await toApiError(
      jsonResponse(
        {
          success: false,
          error: { code: 'CONFLICT', message: 'Role already exists', correlationId: 'c-2' },
        },
        { status: 409 },
      ),
    );
    expect(envelope.code).toBe('CONFLICT');
    expect(envelope.message).toBe('Role already exists');
    expect(envelope.correlationId).toBe('c-2');

    const nest = await toApiError(
      jsonResponse(
        { statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' },
        { status: 403 },
      ),
    );
    expect(nest.code).toBe('FORBIDDEN');
    expect(nest.isForbidden).toBe(true);
    expect(nest.title).toBe('Forbidden');

    const text = await toApiError(
      new Response('boom', { status: 503, statusText: 'Service Unavailable' }),
    );
    expect(text.code).toBe('SERVICE_UNAVAILABLE');
    expect(text.detail).toBe('boom');
  });

  it('turns network failures into ApiError with status 0', async () => {
    const fetchMock = vi.fn<FetchLike>().mockRejectedValue(new TypeError('fetch failed'));
    const client = new ApiClient({ baseUrl: '', fetch: fetchMock });

    const error = (await client.get('/v1/x').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.status).toBe(0);
  });

  it('validates response bodies with the provided schema', async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ id: 'not-a-number' }));
    const client = new ApiClient({ baseUrl: '', fetch: fetchMock });

    const error = (await client
      .get('/v1/x', { schema: z.object({ id: z.number() }) })
      .catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('INVALID_RESPONSE');
    expect(error.errors[0]?.path).toBe('id');

    fetchMock.mockResolvedValue(jsonResponse({ id: 7 }));
    await expect(client.get('/v1/x', { schema: z.object({ id: z.number() }) })).resolves.toEqual({
      id: 7,
    });
  });

  it('returns undefined for 204 responses', async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new ApiClient({ baseUrl: '', fetch: fetchMock });
    await expect(client.delete('/v1/x')).resolves.toBeUndefined();
  });
});

describe('createAdminApi', () => {
  it('targets the contract paths and validates the typed responses', async () => {
    const now = '2026-01-01T00:00:00.000Z';
    const fetchMock = vi.fn<FetchLike>((url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/health')
        return Promise.resolve(jsonResponse({ status: 'ok', details: { db: { status: 'up' } } }));
      if (path === '/v1/roles') {
        return Promise.resolve(
          jsonResponse([
            {
              id: '2c1e0f48-8c0d-4fd9-9d5f-1f4b0a9b0a11',
              name: 'ADMIN',
              description: null,
              isSystem: true,
              permissions: ['users:read'],
              createdAt: now,
              updatedAt: now,
            },
          ]),
        );
      }
      if (path === '/v1/users/u1/suspend') return Promise.resolve(jsonResponse({ nope: true }));
      if (path === '/v1/users/u1/roles') {
        return Promise.resolve(
          jsonResponse({
            userId: '2c1e0f48-8c0d-4fd9-9d5f-1f4b0a9b0a11',
            roles: [{ id: '2c1e0f48-8c0d-4fd9-9d5f-1f4b0a9b0a11', name: 'ADMIN', isSystem: true }],
          }),
        );
      }
      if (path === '/v1/feature-flags/auth.mfa.totp' || path === '/v1/settings/platform.name') {
        return Promise.resolve(jsonResponse({ echoed: true }));
      }
      return Promise.resolve(problemResponse(404, { title: 'Not found', code: 'NOT_FOUND' }));
    });
    const api = createAdminApi(new ApiClient({ baseUrl: 'https://api.test', fetch: fetchMock }));

    await expect(api.health.get()).resolves.toMatchObject({ status: 'ok' });
    await expect(api.roles.list()).resolves.toHaveLength(1);

    const invalid = (await api.users
      .suspend('u1', { reason: 'fraud' })
      .catch((e: unknown) => e)) as ApiError;
    expect(invalid.code).toBe('INVALID_RESPONSE');
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('POST');

    await expect(api.users.assignRoles('u1', { roleIds: [] })).resolves.toMatchObject({
      roles: [{ name: 'ADMIN' }],
    });
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('PUT');

    const missing = (await api.users.get('nope').catch((e: unknown) => e)) as ApiError;
    expect(missing.code).toBe('NOT_FOUND');
  });

  it('sends the API query/body names: reactivate reason, audit filters, PUT flags and settings', async () => {
    const fetchMock = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse({ unexpected: true })));
    const api = createAdminApi(new ApiClient({ baseUrl: 'https://api.test', fetch: fetchMock }));

    await api.users.reactivate('u1', { reason: 'appeal upheld' }).catch(() => undefined);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('https://api.test/v1/users/u1/reactivate');
    expect(fetchMock.mock.calls.at(-1)?.[1]?.body).toBe(
      JSON.stringify({ reason: 'appeal upheld' }),
    );

    await api.audit
      .list({ page: 1, pageSize: 10, actorId: 'a', resource: 'User', action: 'users.update' })
      .catch(() => undefined);
    const auditUrl = new URL(String(fetchMock.mock.calls.at(-1)?.[0]));
    expect([...auditUrl.searchParams.keys()].sort()).toEqual(
      ['action', 'actorId', 'page', 'pageSize', 'resource'].sort(),
    );

    await api.featureFlags
      .upsert('auth.mfa.totp', { enabled: true, rolloutPercentage: 100, rules: [] })
      .catch(() => undefined);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      'https://api.test/v1/feature-flags/auth.mfa.totp',
    );
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('PUT');

    await api.settings
      .upsert('platform.name', { value: 'BI-Rem', isSecret: false })
      .catch(() => undefined);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('https://api.test/v1/settings/platform.name');
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('PUT');

    await api.apiKeys.create({ name: 'worker', scopes: ['users:read'] }).catch(() => undefined);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.body).toBe(
      JSON.stringify({ name: 'worker', scopes: ['users:read'] }),
    );
  });
});
