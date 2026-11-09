import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorCode, FieldError } from '@bi-rem/shared';

export interface ApiExceptionBody {
  code: ApiErrorCode;
  message: string;
  errors?: FieldError[];
}

/**
 * HttpException carrying a stable machine-readable `code` (see `API_ERROR_CODES` in
 * `@bi-rem/shared`), rendered by the ProblemDetails filter.
 */
export class ApiException extends HttpException {
  readonly code: ApiErrorCode;
  readonly errors: FieldError[] | undefined;

  constructor(status: HttpStatus, code: ApiErrorCode, message: string, errors?: FieldError[]) {
    const body: ApiExceptionBody = { code, message, ...(errors ? { errors } : {}) };
    super(body, status);
    this.code = code;
    this.errors = errors;
  }

  static badRequest(message: string, errors?: FieldError[]): ApiException {
    return new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', message, errors);
  }
  static unauthenticated(message = 'Authentication required'): ApiException {
    return new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', message);
  }
  static invalidCredentials(message = 'Invalid email or password'): ApiException {
    return new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', message);
  }
  static forbidden(message = 'You do not have permission to perform this action'): ApiException {
    return new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found'): ApiException {
    return new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', message);
  }
  static conflict(message: string): ApiException {
    return new ApiException(HttpStatus.CONFLICT, 'CONFLICT', message);
  }
  static accountLocked(message = 'Account is temporarily locked'): ApiException {
    return new ApiException(HttpStatus.LOCKED, 'ACCOUNT_LOCKED', message);
  }
  static accountSuspended(message = 'Account is suspended'): ApiException {
    return new ApiException(HttpStatus.FORBIDDEN, 'ACCOUNT_SUSPENDED', message);
  }
  static tokenExpired(message = 'Token has expired'): ApiException {
    return new ApiException(HttpStatus.UNAUTHORIZED, 'TOKEN_EXPIRED', message);
  }
  static tokenRevoked(message = 'Token has been revoked'): ApiException {
    return new ApiException(HttpStatus.UNAUTHORIZED, 'TOKEN_REVOKED', message);
  }
  static mfaInvalid(message = 'Invalid verification code'): ApiException {
    return new ApiException(HttpStatus.UNAUTHORIZED, 'MFA_INVALID', message);
  }
  static serviceUnavailable(message = 'Service unavailable'): ApiException {
    return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE', message);
  }
}
