import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { MetricsService } from './metrics.service.js';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationService,
  ) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(): Promise<string> {
    await this.refreshGauges();
    return this.metrics.render();
  }

  private async refreshGauges(): Promise<void> {
    const [pending, queue] = await Promise.allSettled([
      this.outbox.countPending(),
      this.notifications.queueStats(),
    ]);
    if (pending.status === 'fulfilled') this.metrics.outboxPending.set(pending.value);
    if (queue.status === 'fulfilled') {
      for (const state of ['waiting', 'active', 'failed'] as const) {
        this.metrics.queueJobs.set({ queue: 'notifications', state }, queue.value[state]);
      }
    }
  }
}
