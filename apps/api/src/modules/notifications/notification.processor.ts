import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@bi-rem/db';

import { PrismaService } from '../../prisma/prisma.service.js';
import {
  NOTIFICATION_PROVIDERS,
  type NotificationProvider,
  type OutboundMessage,
} from './providers/notification-provider.js';
import { isSensitivePayload, scrubSensitivePayload } from './notification.service.js';
import type { NotificationJobHandler } from './queue/notification-queue.js';

interface StoredPayload {
  subject?: string | null;
  body?: string;
  locale?: string;
}

/** Executes one queued notification: picks the channel provider and records the outcome. */
@Injectable()
export class NotificationProcessor implements NotificationJobHandler {
  private readonly logger = new Logger(NotificationProcessor.name);
  private readonly providers: ReadonlyMap<NotificationChannel, NotificationProvider>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_PROVIDERS) providers: NotificationProvider[],
  ) {
    this.providers = new Map(providers.map((provider) => [provider.channel, provider]));
  }

  async process(notificationId: string): Promise<void> {
    const notification = await this.prisma.client.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) {
      this.logger.warn({ notificationId }, 'Notification vanished before processing');
      return;
    }
    if (
      notification.status === 'SENT' ||
      notification.status === 'DELIVERED' ||
      notification.status === 'CANCELLED'
    ) {
      return;
    }
    const provider = this.providers.get(notification.channel);
    const payload = (notification.payload ?? {}) as StoredPayload;
    if (!provider) {
      await this.fail(
        notificationId,
        notification.attempts,
        `No provider for channel ${notification.channel}`,
      );
      throw new Error(`No provider for channel ${notification.channel}`);
    }
    const message: OutboundMessage = {
      notificationId,
      userId: notification.userId,
      channel: notification.channel,
      recipient: notification.recipient,
      subject: payload.subject ?? null,
      body: payload.body ?? '',
      locale: payload.locale ?? 'en',
      templateKey: notification.templateKey,
    };
    // Credentials embedded in the message are scrubbed from storage once the provider has taken
    // the message. Failed attempts keep the body because retries re-read it from the row (the
    // queue only carries the id); administrators never see it either way (see `list`).
    const scrub = isSensitivePayload(notification.payload)
      ? { payload: scrubSensitivePayload(notification.payload) }
      : {};
    try {
      const result = await provider.send(message);
      const now = new Date();
      await this.prisma.client.notification.update({
        where: { id: notificationId },
        data: {
          status: result.delivered ? 'DELIVERED' : 'SENT',
          sentAt: now,
          deliveredAt: result.delivered ? now : null,
          attempts: { increment: 1 },
          lastError: null,
          ...scrub,
        },
      });
    } catch (error) {
      await this.fail(
        notificationId,
        notification.attempts,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private async fail(notificationId: string, attempts: number, reason: string): Promise<void> {
    await this.prisma.client.notification.update({
      where: { id: notificationId },
      data: { status: 'FAILED', attempts: attempts + 1, lastError: reason.slice(0, 2_000) },
    });
  }
}
