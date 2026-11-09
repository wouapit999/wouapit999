import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';
import type { AuditOutcome } from '@bi-rem/db';

import type { AuthenticatedRequest } from '../../common/auth/principal.js';
import { RequestContext } from '../../common/context/request-context.js';
import {
  AUDIT_KEY,
  AUDIT_SKIP_KEY,
  type AuditOptions,
} from '../../common/decorators/audit.decorator.js';
import { AuditLogService } from './audit-log.service.js';
import { redact } from './redact.js';

type AuditedRequest = Request & AuthenticatedRequest;

/** Request body size kept in the audit row before truncation (characters once serialised). */
const MAX_BODY_CHARS = 8_000;

/**
 * Records every non-GET request as an `AuditLog` row: who did what to which resource, with a
 * redacted copy of the request body as `after` and whatever snapshot the service stored in
 * the request context as `before`.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditLog: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<AuditedRequest>();
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return next.handle();
    }
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(AUDIT_SKIP_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const startedAt = Date.now();
    const descriptor = this.describe(context);
    return next.handle().pipe(
      tap({
        next: (body) => {
          void this.write(request, descriptor, body, null, startedAt);
        },
        error: (error: unknown) => {
          void this.write(request, descriptor, null, error, startedAt);
        },
      }),
    );
  }

  /** Derives `{ action, resource, idParam }` from metadata or from controller/handler names. */
  describe(context: ExecutionContext): Required<AuditOptions> {
    const options =
      this.reflector.getAllAndOverride<AuditOptions | undefined>(AUDIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? {};
    const controller = context.getClass().name.replace(/Controller$/, '');
    const handler = context.getHandler().name;
    return {
      action: options.action ?? `${toKebab(controller)}.${toKebab(handler)}`,
      resource: options.resource ?? singularize(controller),
      idParam: options.idParam ?? 'id',
    };
  }

  private async write(
    request: AuditedRequest,
    descriptor: Required<AuditOptions>,
    responseBody: unknown,
    error: unknown,
    startedAt: number,
  ): Promise<void> {
    try {
      const store = RequestContext.current();
      const status = error ? statusOf(error) : (request.res?.statusCode ?? 200);
      const outcome = outcomeFor(status, error);
      const params = request.params as Record<string, string | undefined>;
      const resourceId =
        store?.auditResourceId ?? params[descriptor.idParam] ?? extractId(responseBody) ?? null;
      const actor = store?.actor ?? request.user;
      await this.auditLog.record({
        action: descriptor.action,
        resourceType: descriptor.resource,
        resourceId,
        outcome,
        actorUserId: actor?.userId ?? null,
        actorType: actor?.type === 'API_KEY' ? 'API_KEY' : 'USER',
        before: store?.auditBefore,
        // Redact before truncating: the truncated preview is a plain string, which the
        // key-based redaction in AuditLogService could no longer scrub.
        after: store?.auditAfter ?? truncateBody(redact(request.body)),
        metadata: {
          method: request.method,
          route: routePath(request),
          path: request.originalUrl,
          statusCode: status,
          durationMs: Date.now() - startedAt,
          ...(error instanceof HttpException ? { error: error.message } : {}),
          ...(Object.keys(params).length ? { params } : {}),
        },
        ip: request.ip ?? null,
        userAgent:
          typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
      });
    } catch (writeError) {
      this.logger.error({ err: writeError }, 'Audit interceptor failed');
    }
  }
}

/** Express route template (`/v1/users/:id`) when the request matched a route, else the raw path. */
export function routePath(request: Request): string {
  const route = (request as { route?: { path?: unknown } }).route;
  return typeof route?.path === 'string' ? route.path : request.path;
}

function statusOf(error: unknown): number {
  return error instanceof HttpException ? error.getStatus() : 500;
}

function outcomeFor(status: number, error: unknown): AuditOutcome {
  if (!error && status < 400) return 'SUCCESS';
  if (status === 401 || status === 403 || status === 423) return 'DENIED';
  return 'FAILURE';
}

function extractId(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

function truncateBody(body: unknown): unknown {
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'object') return body;
  const serialised = JSON.stringify(body);
  if (serialised.length <= MAX_BODY_CHARS) return body;
  return { _truncated: true, preview: serialised.slice(0, MAX_BODY_CHARS) };
}

function toKebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function singularize(value: string): string {
  if (value.endsWith('ies')) return value.replace(/ies$/, 'y');
  if (/(ss|us)$/.test(value)) return value;
  if (value.endsWith('s')) return value.slice(0, -1);
  return value;
}
