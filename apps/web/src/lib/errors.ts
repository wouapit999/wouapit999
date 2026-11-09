import type { Translator } from '@/i18n';
import { ApiError, type ApiErrorKind, isApiError } from '@/lib/api';

const SESSION_ERROR_CODES: ReadonlySet<ApiErrorKind> = new Set<ApiErrorKind>([
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'TOKEN_REVOKED',
]);

/** Turns any thrown value into a user-facing message in the current locale. */
export function describeError(error: unknown, t: Translator): string {
  if (isApiError(error)) {
    if (error.code === 'NETWORK_ERROR') return t('state.error.network');
    if (SESSION_ERROR_CODES.has(error.code)) return t('state.error.unauthorized');
    if (error.code === 'RATE_LIMITED') return t('state.error.rateLimited');
    return error.detail ?? error.title;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return t('state.error.generic');
}

export function correlationIdOf(error: unknown): string | undefined {
  return error instanceof ApiError ? error.correlationId : undefined;
}
