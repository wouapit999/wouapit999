import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** Prometheus registry for the API. One instance per process. */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registry],
  });

  readonly authLoginTotal = new Counter({
    name: 'auth_login_total',
    help: 'Login attempts by realm and outcome',
    labelNames: ['realm', 'outcome'] as const,
    registers: [this.registry],
  });

  readonly outboxPending = new Gauge({
    name: 'outbox_pending_total',
    help: 'Outbox rows waiting to be relayed',
    registers: [this.registry],
  });

  readonly queueJobs = new Gauge({
    name: 'bullmq_queue_jobs',
    help: 'Notification queue jobs by state',
    labelNames: ['queue', 'state'] as const,
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({ service: 'bi-rem-api' });
    collectDefaultMetrics({ register: this.registry });
  }

  observeHttp(method: string, route: string, statusCode: number, durationSeconds: number): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequestDuration.observe(labels, durationSeconds);
    this.httpRequestsTotal.inc(labels);
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
