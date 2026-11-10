/**
 * Typed application errors. Services throw `AppError`; server actions and route handlers map
 * them to form state / HTTP responses (see `@/lib/action` and `@/lib/http`).
 */

export const ERROR_STATUS = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  INSUFFICIENT_FUNDS: 422,
  LIMIT_EXCEEDED: 422,
  KYC_REQUIRED: 422,
  QUOTE_EXPIRED: 422,
  UNSUPPORTED: 422,
  RATE_LIMITED: 429,
  PROVIDER_ERROR: 502,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Optional per-field messages (forms) or structured details (API). */
  readonly fieldErrors?: Record<string, string[]>;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options: { fieldErrors?: Record<string, string[]>; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You are not allowed to do this') =>
  new AppError('FORBIDDEN', message);
export const invalidState = (message: string) => new AppError('INVALID_STATE', message);
export const validation = (message: string, fieldErrors?: Record<string, string[]>) =>
  new AppError('VALIDATION', message, { fieldErrors });

/** Postgres / Prisma unique-violation detector (P2002 or SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'P2002' || code === '23505';
}
