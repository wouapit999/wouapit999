import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';

import { REDIS_CLIENT, type RedisClient } from '../../../redis/redis.module.js';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    private readonly health: HealthIndicatorService,
  ) {}

  async isHealthy(key = 'redis'): Promise<HealthIndicatorResult> {
    const indicator = this.health.check(key);
    if (!this.redis) return indicator.up({ configured: false });
    const started = Date.now();
    try {
      await this.redis.ping();
      return indicator.up({ configured: true, latencyMs: Date.now() - started });
    } catch (error) {
      return indicator.down({
        configured: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
