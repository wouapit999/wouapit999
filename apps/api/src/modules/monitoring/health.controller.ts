import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';

import { Public } from '../../common/decorators/public.decorator.js';
import { PrismaHealthIndicator } from './indicators/prisma.indicator.js';
import { RedisHealthIndicator } from './indicators/redis.indicator.js';

/** 1 GiB RSS ceiling before the process reports itself unhealthy. */
const MEMORY_RSS_LIMIT_BYTES = 1024 * 1024 * 1024;

@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  /** Overall health: database, Redis and memory. */
  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prisma.isHealthy(),
      () => this.redis.isHealthy(),
      () => this.memory.checkRSS('memory_rss', MEMORY_RSS_LIMIT_BYTES),
    ]);
  }

  /** Liveness: the process is up and the event loop responds. */
  @Public()
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /** Readiness: dependencies needed to serve traffic. */
  @Public()
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.prisma.isHealthy(), () => this.redis.isHealthy()]);
  }
}
