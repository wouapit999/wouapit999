import * as Sentry from '@sentry/node';

export interface SentryOptions {
  dsn: string | undefined;
  environment: string;
  release?: string;
}

/** Initialises Sentry when a DSN is configured. Safe to call once at boot before Nest starts. */
export function initSentry(options: SentryOptions): boolean {
  if (!options.dsn) return false;
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    tracesSampleRate: options.environment === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers['x-api-key'];
        delete event.request.headers.cookie;
      }
      return event;
    },
  });
  return true;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!Sentry.getClient()) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
