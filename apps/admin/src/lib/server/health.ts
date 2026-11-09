import 'server-only';

import { getApiBaseUrl, getServerEnv } from '@/env';
import { API } from '@/lib/routes';
import { type HealthReport, healthSchema } from '@/lib/schemas';

export type HealthProbe =
  | { state: 'ok' | 'degraded'; report: HealthReport; latencyMs: number; checkedAt: string }
  | { state: 'unreachable'; reason: string; latencyMs: number; checkedAt: string };

/**
 * Server-side probe of `GET /health`. Runs in the dashboard server component so the API origin
 * never has to accept browser traffic for health, and a slow API cannot hang the page: the probe
 * aborts after `HEALTH_TIMEOUT_MS`. Terminus answers 503 with the same body when degraded.
 */
export async function probeHealth(): Promise<HealthProbe> {
  const started = Date.now();
  const checkedAt = new Date(started).toISOString();
  const finish = () => Date.now() - started;

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${API.health}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(getServerEnv().HEALTH_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return {
      state: 'unreachable',
      reason: timedOut ? 'The health endpoint did not answer in time.' : 'Connection failed.',
      latencyMs: finish(),
      checkedAt,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      state: 'unreachable',
      reason: `HTTP ${response.status} with a non-JSON body.`,
      latencyMs: finish(),
      checkedAt,
    };
  }

  const parsed = healthSchema.safeParse(body);
  if (!parsed.success) {
    return {
      state: 'unreachable',
      reason: `HTTP ${response.status} with an unexpected body.`,
      latencyMs: finish(),
      checkedAt,
    };
  }

  return {
    state: parsed.data.status === 'ok' ? 'ok' : 'degraded',
    report: parsed.data,
    latencyMs: finish(),
    checkedAt,
  };
}
