import { Logger } from '@nestjs/common';

import type { NotificationJobHandler, NotificationQueue } from './notification-queue.js';

/**
 * Fallback used when REDIS_URL is not configured (tests, minimal dev setups): dispatches on
 * the next tick with a small retry loop. Not durable: a crash loses queued work, which is
 * acceptable only outside production.
 */
export class InProcessNotificationQueue implements NotificationQueue {
  readonly kind = 'in-process' as const;
  private readonly logger = new Logger(InProcessNotificationQueue.name);
  private readonly inFlight = new Set<Promise<void>>();
  private waiting = 0;
  private failed = 0;

  constructor(
    private readonly handler: NotificationJobHandler,
    private readonly maxAttempts = 3,
    private readonly retryDelayMs = 250,
  ) {}

  enqueue(notificationId: string): Promise<void> {
    this.waiting += 1;
    const run = (async () => {
      await new Promise((resolve) => setImmediate(resolve));
      this.waiting -= 1;
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          await this.handler.process(notificationId);
          return;
        } catch (error) {
          if (attempt === this.maxAttempts) {
            this.failed += 1;
            this.logger.error({ err: error, notificationId }, 'Notification failed after retries');
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
        }
      }
    })();
    this.inFlight.add(run);
    void run.finally(() => this.inFlight.delete(run));
    return Promise.resolve();
  }

  stats(): Promise<{ waiting: number; active: number; failed: number }> {
    return Promise.resolve({
      waiting: this.waiting,
      active: this.inFlight.size,
      failed: this.failed,
    });
  }

  /** Waits for in-flight work so tests and graceful shutdown can observe final states. */
  async close(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }
}
