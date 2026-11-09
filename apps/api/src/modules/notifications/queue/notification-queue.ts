export const NOTIFICATION_QUEUE = Symbol('NOTIFICATION_QUEUE');
export const NOTIFICATIONS_QUEUE_NAME = 'notifications';

/** Hands persisted notifications to the processor, durably (BullMQ) or in-process (fallback). */
export interface NotificationQueue {
  readonly kind: 'bullmq' | 'in-process';
  enqueue(notificationId: string): Promise<void>;
  /** Pending/active job counts for metrics and health. */
  stats(): Promise<{ waiting: number; active: number; failed: number }>;
  close(): Promise<void>;
}

/** The unit of work the queue schedules. */
export interface NotificationJobHandler {
  process(notificationId: string): Promise<void>;
}
