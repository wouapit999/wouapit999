import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';

import { PrismaService } from '../../../prisma/prisma.service.js';

@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthIndicatorService,
  ) {}

  async isHealthy(key = 'database'): Promise<HealthIndicatorResult> {
    const indicator = this.health.check(key);
    const started = Date.now();
    try {
      await this.prisma.ping();
      return indicator.up({ latencyMs: Date.now() - started });
    } catch (error) {
      return indicator.down({ error: error instanceof Error ? error.message : String(error) });
    }
  }
}
