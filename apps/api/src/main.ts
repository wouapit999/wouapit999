import 'reflect-metadata';

import { initSentry } from './modules/monitoring/sentry.js';

/**
 * Entry point. Observability agents must be loaded before any application module so they can
 * instrument http/express/pg at require time, hence the dynamic imports below.
 */
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  await import('./tracing.js');
}
initSentry({
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.NODE_ENV ?? 'development',
  release: process.env.GIT_SHA ?? process.env.npm_package_version,
});

const { bootstrap } = await import('./bootstrap.js');
await bootstrap().catch((error: unknown) => {
  console.error('Fatal: API failed to start', error);
  process.exit(1);
});
