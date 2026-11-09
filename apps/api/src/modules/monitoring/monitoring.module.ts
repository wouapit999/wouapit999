import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller.js';
import { PrismaHealthIndicator } from './indicators/prisma.indicator.js';
import { RedisHealthIndicator } from './indicators/redis.indicator.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsInterceptor } from './metrics.interceptor.js';
import { MetricsService } from './metrics.service.js';

@Module({
  imports: [TerminusModule.forRoot({ logger: false })],
  controllers: [HealthController, MetricsController],
  providers: [
    MetricsService,
    PrismaHealthIndicator,
    RedisHealthIndicator,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class MonitoringModule {}
