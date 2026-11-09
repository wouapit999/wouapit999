import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { type Observable, tap } from 'rxjs';

import { routePath } from '../audit/audit.interceptor.js';
import { MetricsService } from './metrics.service.js';

/** Matches the two credential endpoints, with or without the `/v1` global prefix. */
const LOGIN_ROUTE = /^(?:\/v1)?\/auth\/(admin\/)?login\/?$/;

export type LoginRealmLabel = 'CUSTOMER' | 'ADMIN';
export type LoginOutcomeLabel =
  | 'success'
  | 'mfa_required'
  | 'invalid_credentials'
  | 'locked'
  | 'throttled'
  | 'invalid_request'
  | 'error';

/** Realm served by a login route, or `undefined` when the route is not a login endpoint. */
export function loginRealmFor(route: string): LoginRealmLabel | undefined {
  const match = LOGIN_ROUTE.exec(route);
  if (!match) return undefined;
  return match[1] ? 'ADMIN' : 'CUSTOMER';
}

/**
 * Maps a login response to the `outcome` label of `auth_login_total`. A 200 whose body carries
 * `mfaRequired` is a pending second factor, not a completed login.
 */
export function loginOutcomeFor(statusCode: number, body: unknown): LoginOutcomeLabel {
  if (statusCode < 400) {
    const mfaRequired =
      typeof body === 'object' &&
      body !== null &&
      (body as { mfaRequired?: unknown }).mfaRequired === true;
    return mfaRequired ? 'mfa_required' : 'success';
  }
  switch (statusCode) {
    case 400:
      return 'invalid_request';
    case 401:
      return 'invalid_credentials';
    case 423:
      return 'locked';
    case 429:
      return 'throttled';
    default:
      return 'error';
  }
}

/**
 * Records `http_request_duration_seconds{method,route,status_code}` for every handled request and
 * `auth_login_total{realm,outcome}` for the login endpoints.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const route = routePath(request);
    const loginRealm = request.method === 'POST' ? loginRealmFor(route) : undefined;
    const started = process.hrtime.bigint();
    const observe = (statusCode: number, body: unknown) => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      this.metrics.observeHttp(request.method, route, statusCode, seconds);
      if (loginRealm) {
        this.metrics.authLoginTotal.inc({
          realm: loginRealm,
          outcome: loginOutcomeFor(statusCode, body),
        });
      }
    };
    return next.handle().pipe(
      tap({
        next: (body) => observe(response.statusCode, body),
        error: (error: unknown) =>
          observe(error instanceof HttpException ? error.getStatus() : 500, undefined),
      }),
    );
  }
}
