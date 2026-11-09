import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import type { AppConfig } from '../config/env.js';

/** Injection token for the optional shared ioredis client (`null` when REDIS_URL is unset). */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export type RedisClient = Redis | null;

const logger = new Logger('RedisModule');

export function createRedisClient(url: string | undefined): RedisClient {
  if (!url) {
    logger.warn('REDIS_URL not set: using in-process fallbacks for queues and caches');
    return null;
  }
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
  });
  client.on('error', (error: Error) => logger.error({ err: error }, 'Redis error'));
  client.connect().catch((error: unknown) => logger.error({ err: error }, 'Redis connect failed'));
  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): RedisClient =>
        createRedisClient(config.get('REDIS_URL', { infer: true })),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClient) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => this.client?.disconnect());
    }
  }
}
