import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/env.js';
import { NotificationProcessor } from './notification.processor.js';
import { NotificationService } from './notification.service.js';
import { NotificationsController } from './notifications.controller.js';
import { EmailProvider } from './providers/email.provider.js';
import { InAppProvider } from './providers/in-app.provider.js';
import {
  NOTIFICATION_PROVIDERS,
  type NotificationProvider,
} from './providers/notification-provider.js';
import { LoggingSmsProvider } from './providers/sms.provider.js';
import { BullmqNotificationQueue } from './queue/bullmq.queue.js';
import { InProcessNotificationQueue } from './queue/in-process.queue.js';
import { NOTIFICATION_QUEUE, type NotificationQueue } from './queue/notification-queue.js';

const logger = new Logger('NotificationsModule');

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    EmailProvider,
    LoggingSmsProvider,
    InAppProvider,
    {
      provide: NOTIFICATION_PROVIDERS,
      inject: [EmailProvider, LoggingSmsProvider, InAppProvider],
      useFactory: (...providers: NotificationProvider[]) => providers,
    },
    NotificationProcessor,
    {
      provide: NOTIFICATION_QUEUE,
      inject: [ConfigService, NotificationProcessor],
      useFactory: (
        config: ConfigService<AppConfig, true>,
        processor: NotificationProcessor,
      ): NotificationQueue => {
        const redisUrl = config.get('REDIS_URL', { infer: true });
        if (redisUrl) {
          logger.log('Notifications queue: BullMQ (Redis)');
          return new BullmqNotificationQueue(redisUrl, processor);
        }
        logger.warn('Notifications queue: in-process dispatcher (REDIS_URL unset, not durable)');
        return new InProcessNotificationQueue(processor);
      },
    },
    NotificationService,
  ],
  exports: [NotificationService],
})
export class NotificationsModule implements OnApplicationShutdown {
  constructor(@Inject(NOTIFICATION_QUEUE) private readonly queue: NotificationQueue) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
