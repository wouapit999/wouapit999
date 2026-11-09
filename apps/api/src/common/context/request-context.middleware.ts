import type { NextFunction, Request, Response } from 'express';
import { HTTP_HEADERS, resolveCorrelationId } from '@bi-rem/shared';

import { RequestContext } from './request-context.js';

/**
 * Express-level middleware (registered before Nest's own chain) that normalises the
 * `x-request-id` header, echoes it and opens the AsyncLocalStorage context for the request.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = resolveCorrelationId(req.headers[HTTP_HEADERS.requestId]);
  req.headers[HTTP_HEADERS.requestId] = correlationId;
  res.setHeader(HTTP_HEADERS.requestId, correlationId);
  RequestContext.run(
    {
      correlationId,
      ip: req.ip,
      userAgent:
        typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    },
    () => next(),
  );
}
