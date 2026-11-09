import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/**
 * OpenTelemetry bootstrap. Imported by main.ts BEFORE the application modules when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set, so the auto-instrumentations can patch http/express/pg/ioredis.
 */
export function startTracing(
  endpoint: string,
  serviceVersion = process.env.npm_package_version ?? '0.1.0',
): NodeSDK {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'bi-rem-api',
      [ATTR_SERVICE_VERSION]: serviceVersion,
      'deployment.environment.name': process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (request) =>
            request.url === '/metrics' || request.url?.startsWith('/health') === true,
        },
      }),
    ],
  });
  sdk.start();
  const shutdown = () => {
    sdk.shutdown().catch((error: unknown) => console.error('OpenTelemetry shutdown failed', error));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return sdk;
}

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (endpoint) startTracing(endpoint);
