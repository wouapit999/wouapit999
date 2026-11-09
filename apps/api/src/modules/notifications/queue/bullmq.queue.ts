import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import {
  NOTIFICATIONS_QUEUE_NAME,
  type NotificationJobHandler,
  type NotificationQueue,
} from './notification-queue.js';

interface NotificationJobData {
  notificationId: string;
}

/** Durable queue backed by Redis/BullMQ: 5 attempts with exponential backoff from 30 s. */
export class BullmqNotificationQueue implements NotificationQueue {
  readonly kind = 'bullmq' as const;
  private readonly logger = new Logger(BullmqNotificationQueue.name);
  private readonly queue: Queue<NotificationJobData>;
  private readonly worker: Worker<NotificationJobData>;
  private readonly connections: Redis[] = [];

  constructor(redisUrl: string, handler: NotificationJobHandler, concurrency = 5) {
    const queueConnection = this.connection(redisUrl);
    const workerConnection = this.connection(redisUrl);
    this.queue = new Queue<NotificationJobData>(NOTIFICATIONS_QUEUE_NAME, {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 24 * 3_600, count: 10_000 },
        removeOnFail: { age: 7 * 24 * 3_600 },
      },
    });
    this.worker = new Worker<NotificationJobData>(
      NOTIFICATIONS_QUEUE_NAME,
      async (job) => {
        await handler.process(job.data.notificationId);
      },
      { connection: workerConnection, concurrency },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        { err: error, jobId: job?.id, notificationId: job?.data.notificationId },
        'Notification job failed',
      );
    });
    this.worker.on('error', (error) =>
      this.logger.error({ err: error }, 'Notification worker error'),
    );
  }

  private connection(url: string): Redis {
    // BullMQ requires maxRetriesPerRequest: null on its blocking connections.
    const client = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
    client.on('error', (error: Error) => this.logger.error({ err: error }, 'Queue Redis error'));
    this.connections.push(client);
    return client;
  }

  async enqueue(notificationId: string): Promise<void> {
    await this.queue.add('send', { notificationId }, { jobId: notificationId });
  }

  async stats(): Promise<{ waiting: number; active: number; failed: number }> {
    const counts = await this.queue.getJobCounts('waiting', 'delayed', 'active', 'failed');
    return {
      waiting: (counts.waiting ?? 0) + (counts.delayed ?? 0),
      active: counts.active ?? 0,
      failed: counts.failed ?? 0,
    };
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    await Promise.allSettled(this.connections.map((connection) => connection.quit()));
  }
}
