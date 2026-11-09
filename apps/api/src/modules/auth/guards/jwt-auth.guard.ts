import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { TokenExpiredError } from '@nestjs/jwt';
import { HTTP_HEADERS } from '@bi-rem/shared';

import type {
  AuthenticatedPrincipal,
  AuthenticatedRequest,
} from '../../../common/auth/principal.js';
import { RequestContext } from '../../../common/context/request-context.js';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator.js';
import { ApiException } from '../../../common/errors/api-exception.js';
import { ApiKeysService } from '../../api-keys/api-keys.service.js';

type GuardedRequest = Request & AuthenticatedRequest;

/**
 * Global authentication guard. Order of precedence:
 *  1. `@Public()` routes pass through (a valid bearer token is still attached when present).
 *  2. `x-api-key` header → service-account principal (scopes become its permissions).
 *  3. `Authorization: Bearer <jwt>` → user principal via JwtStrategy.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeysService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const apiKeyHeader = request.headers[HTTP_HEADERS.apiKey];
    const rawApiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
    if (rawApiKey) {
      const principal = await this.apiKeys.authenticate(rawApiKey);
      if (!principal) {
        if (isPublic) return true;
        throw ApiException.unauthenticated('Invalid API key');
      }
      this.attach(request, principal);
      return true;
    }

    if (isPublic) {
      if (!request.headers.authorization) return true;
      try {
        await super.canActivate(context);
        if (request.user) this.attach(request, request.user);
      } catch {
        // Public route: an invalid/expired token is ignored rather than rejected.
        request.user = undefined;
      }
      return true;
    }

    const ok = await super.canActivate(context);
    if (ok && request.user) this.attach(request, request.user);
    return ok === true;
  }

  override handleRequest<TUser = AuthenticatedPrincipal>(
    err: unknown,
    user: unknown,
    info: unknown,
  ): TUser {
    if (err instanceof ApiException) throw err;
    if (err) throw ApiException.unauthenticated();
    if (!user) {
      if (
        info instanceof TokenExpiredError ||
        (info as { name?: string } | undefined)?.name === 'TokenExpiredError'
      ) {
        throw ApiException.tokenExpired('Access token has expired');
      }
      throw ApiException.unauthenticated();
    }
    return user as TUser;
  }

  private attach(request: GuardedRequest, principal: AuthenticatedPrincipal): void {
    request.user = principal;
    RequestContext.setActor(principal);
  }
}
