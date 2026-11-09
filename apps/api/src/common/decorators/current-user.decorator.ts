import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedPrincipal, AuthenticatedRequest } from '../auth/principal.js';

/** Injects the authenticated principal (or one of its properties) into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (property: keyof AuthenticatedPrincipal | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.user;
    if (!principal) return undefined;
    return property ? principal[property] : principal;
  },
);
