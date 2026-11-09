import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  API_ERROR_CODES,
  type ApiErrorCode,
  type FieldError,
  type ProblemDetails,
} from '@bi-rem/shared';

import { RequestContext } from '../context/request-context.js';
import { ApiException } from '../errors/api-exception.js';

const STATUS_TITLES: Partial<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  423: 'Locked',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

const STATUS_CODES: Partial<Record<number, ApiErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  423: 'ACCOUNT_LOCKED',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

interface NestErrorBody {
  message?: string | string[];
  code?: string;
  errors?: FieldError[];
}

function isHealthReport(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'status' in body &&
    'details' in body &&
    typeof (body as { status: unknown }).status === 'string'
  );
}

const API_ERROR_CODE_SET: ReadonlySet<string> = new Set(API_ERROR_CODES);

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && API_ERROR_CODE_SET.has(value);
}

interface HttpLikeError {
  status: number;
  type: string | undefined;
}

/** Safe wording for the body-parser failures Express raises before Nest sees the request. */
const HTTP_ERROR_DETAILS: Readonly<Record<string, string>> = {
  'entity.parse.failed': 'Malformed JSON body',
  'entity.too.large': 'Request body is too large',
  'encoding.unsupported': 'Unsupported content encoding',
  'charset.unsupported': 'Unsupported charset',
  'request.aborted': 'Request was aborted before the body was received',
  'entity.verify.failed': 'Request body failed verification',
  'stream.encoding.set': 'Request stream encoding is not supported',
};

/**
 * Recognises `http-errors` style exceptions (what `body-parser` throws for malformed or
 * oversized JSON). They are not `HttpException`s, so without this they would surface as 500s
 * and be logged as unhandled errors, although the client is at fault.
 */
function asHttpLikeError(exception: unknown): HttpLikeError | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const candidate = exception as { status?: unknown; statusCode?: unknown; type?: unknown };
  const status =
    typeof candidate.status === 'number'
      ? candidate.status
      : typeof candidate.statusCode === 'number'
        ? candidate.statusCode
        : undefined;
  if (status === undefined || status < 400 || status > 499) return null;
  return { status, type: typeof candidate.type === 'string' ? candidate.type : undefined };
}

/**
 * Renders every error as an RFC 9457 problem document (`application/problem+json`) with the
 * stable `code`, field `errors` and the request `correlationId` as extension members.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    // Terminus health checks throw a ServiceUnavailableException whose body IS the report
    // consumers expect ({ status, info, error, details }); pass it through untouched.
    if (exception instanceof HttpException && isHealthReport(exception.getResponse())) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const problem = this.toProblem(exception, request);

    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, correlationId: problem.correlationId, path: request.url },
        'Unhandled exception',
      );
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  toProblem(exception: unknown, request: Request): ProblemDetails {
    const correlationId =
      RequestContext.correlationId() ??
      (typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : undefined);
    const base = {
      type: 'about:blank',
      instance: request.originalUrl || request.url,
      correlationId,
      timestamp: new Date().toISOString(),
    };

    if (exception instanceof ApiException) {
      const status = exception.getStatus();
      return {
        ...base,
        status,
        title: STATUS_TITLES[status] ?? 'Error',
        detail: exception.message,
        code: exception.code,
        ...(exception.errors ? { errors: exception.errors } : {}),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const parsed: NestErrorBody = typeof body === 'string' ? { message: body } : body;
      const detail = Array.isArray(parsed.message)
        ? parsed.message.join('; ')
        : (parsed.message ?? exception.message);
      const code = isApiErrorCode(parsed.code)
        ? parsed.code
        : (STATUS_CODES[status] ?? 'INTERNAL_ERROR');
      return {
        ...base,
        status,
        title: STATUS_TITLES[status] ?? 'Error',
        detail,
        code,
        ...(parsed.errors ? { errors: parsed.errors } : {}),
      };
    }

    const httpLike = asHttpLikeError(exception);
    if (httpLike) {
      return {
        ...base,
        status: httpLike.status,
        title: STATUS_TITLES[httpLike.status] ?? 'Request Error',
        // The original message may echo request content; only use the curated wording.
        detail: (httpLike.type && HTTP_ERROR_DETAILS[httpLike.type]) ?? 'Invalid request',
        code: STATUS_CODES[httpLike.status] ?? 'VALIDATION_FAILED',
      };
    }

    return {
      ...base,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      title: STATUS_TITLES[500] ?? 'Internal Server Error',
      detail: 'An unexpected error occurred',
      code: 'INTERNAL_ERROR',
    };
  }
}
