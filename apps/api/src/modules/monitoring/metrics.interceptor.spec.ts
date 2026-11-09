import { describe, expect, it } from '@jest/globals';
import { type CallHandler, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';

import { MetricsInterceptor, loginOutcomeFor, loginRealmFor } from './metrics.interceptor.js';
import { MetricsService } from './metrics.service.js';

function context(request: Record<string, unknown>, statusCode = 200): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode }) }),
  } as unknown as ExecutionContext;
}

function handler(body: unknown): CallHandler {
  return { handle: () => of(body) };
}

async function loginCounter(metrics: MetricsService, realm: string, outcome: string) {
  const [metric] = (await metrics.registry.getMetricsAsJSON()).filter(
    (entry) => entry.name === 'auth_login_total',
  );
  const sample = (metric?.values ?? []).find(
    (value) => value.labels.realm === realm && value.labels.outcome === outcome,
  );
  return sample?.value ?? 0;
}

describe('loginRealmFor', () => {
  it('recognises the customer and admin login routes with or without the prefix', () => {
    expect(loginRealmFor('/v1/auth/login')).toBe('CUSTOMER');
    expect(loginRealmFor('/auth/login')).toBe('CUSTOMER');
    expect(loginRealmFor('/v1/auth/admin/login')).toBe('ADMIN');
    expect(loginRealmFor('/v1/auth/mfa/verify')).toBeUndefined();
    expect(loginRealmFor('/v1/users/me')).toBeUndefined();
  });
});

describe('loginOutcomeFor', () => {
  it('maps status codes and MFA challenges to outcome labels', () => {
    expect(loginOutcomeFor(200, { accessToken: 'x' })).toBe('success');
    expect(loginOutcomeFor(200, { mfaRequired: true, mfaToken: 'y' })).toBe('mfa_required');
    expect(loginOutcomeFor(400, undefined)).toBe('invalid_request');
    expect(loginOutcomeFor(401, undefined)).toBe('invalid_credentials');
    expect(loginOutcomeFor(423, undefined)).toBe('locked');
    expect(loginOutcomeFor(429, undefined)).toBe('throttled');
    expect(loginOutcomeFor(500, undefined)).toBe('error');
  });
});

describe('MetricsInterceptor', () => {
  it('records request duration for every request', async () => {
    const metrics = new MetricsService();
    const interceptor = new MetricsInterceptor(metrics);
    await lastValueFrom(
      interceptor.intercept(
        context({ method: 'GET', path: '/v1/users/me', route: { path: '/v1/users/me' } }),
        handler({ id: 'u1' }),
      ),
    );
    const rendered = await metrics.render();
    expect(rendered).toContain(
      'http_requests_total{method="GET",route="/v1/users/me",status_code="200",service="bi-rem-api"} 1',
    );
    expect(await loginCounter(metrics, 'CUSTOMER', 'success')).toBe(0);
  });

  it('counts successful customer logins and pending admin MFA challenges', async () => {
    const metrics = new MetricsService();
    const interceptor = new MetricsInterceptor(metrics);
    await lastValueFrom(
      interceptor.intercept(
        context({ method: 'POST', route: { path: '/v1/auth/login' } }),
        handler({ accessToken: 'a', refreshToken: 'r' }),
      ),
    );
    await lastValueFrom(
      interceptor.intercept(
        context({ method: 'POST', route: { path: '/v1/auth/admin/login' } }),
        handler({ mfaRequired: true, mfaToken: 'm', methods: ['TOTP'] }),
      ),
    );
    expect(await loginCounter(metrics, 'CUSTOMER', 'success')).toBe(1);
    expect(await loginCounter(metrics, 'ADMIN', 'mfa_required')).toBe(1);
    expect(await loginCounter(metrics, 'ADMIN', 'success')).toBe(0);
  });

  it('counts failed logins from the thrown HTTP exception status', async () => {
    const metrics = new MetricsService();
    const interceptor = new MetricsInterceptor(metrics);
    const failing: CallHandler = {
      handle: () => throwError(() => new UnauthorizedException('Invalid credentials')),
    };
    await expect(
      lastValueFrom(
        interceptor.intercept(
          context({ method: 'POST', route: { path: '/v1/auth/admin/login' } }),
          failing,
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await loginCounter(metrics, 'ADMIN', 'invalid_credentials')).toBe(1);
    const rendered = await metrics.render();
    expect(rendered).toContain(
      'http_requests_total{method="POST",route="/v1/auth/admin/login",status_code="401",service="bi-rem-api"} 1',
    );
  });

  it('ignores non-POST requests to login paths and non-HTTP contexts', async () => {
    const metrics = new MetricsService();
    const interceptor = new MetricsInterceptor(metrics);
    await lastValueFrom(
      interceptor.intercept(
        context({ method: 'GET', route: { path: '/v1/auth/login' } }),
        handler(null),
      ),
    );
    const rpc = { getType: () => 'rpc' } as unknown as ExecutionContext;
    await lastValueFrom(interceptor.intercept(rpc, handler('ok')));
    expect(await loginCounter(metrics, 'CUSTOMER', 'success')).toBe(0);
  });
});
