import { ApiError, type ApiErrorKind, isApiError } from '@/lib/api';

const SESSION_ERROR_CODES: ReadonlySet<ApiErrorKind> = new Set<ApiErrorKind>([
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'TOKEN_REVOKED',
]);

/** Turns any thrown value into a user-facing message. */
export function describeError(error: unknown): string {
  if (isApiError(error)) {
    if (error.code === 'NETWORK_ERROR') {
      return 'The API could not be reached. Check your connection and try again.';
    }
    if (SESSION_ERROR_CODES.has(error.code)) {
      return 'Your session has expired. Sign in again to continue.';
    }
    if (error.code === 'FORBIDDEN') {
      return 'You do not have permission to perform this action.';
    }
    if (error.code === 'RATE_LIMITED') {
      return 'Too many requests. Wait a moment before trying again.';
    }
    return error.detail ?? error.title;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

export function correlationIdOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.correlationId : undefined;
}

export function isSessionError(error: unknown): boolean {
  return isApiError(error) && SESSION_ERROR_CODES.has(error.code);
}
