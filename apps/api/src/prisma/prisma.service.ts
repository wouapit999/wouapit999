import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrismaClient, type PrismaClient } from '@bi-rem/db';

import type { AppConfig } from '../config/env.js';

/**
 * Thin lifecycle wrapper around the shared `createPrismaClient` factory. Exposes the client
 * as `prisma.client` (kept as a property rather than inheritance because the generated
 * Prisma 7 client is produced by a factory and is not meant to be subclassed).
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: PrismaClient;

  constructor(config: ConfigService<AppConfig, true>) {
    this.client = createPrismaClient(config.get('databaseRuntimeUrl', { infer: true }), {
      log: config.get('isProduction', { infer: true }) ? ['error'] : ['warn', 'error'],
      maxConnections: 10,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
      this.logger.log('Database connection established');
    } catch (error) {
      // Connection errors surface on the first query and in /health/ready; do not block boot.
      this.logger.error({ err: error }, 'Database connection failed at startup');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /** Lightweight connectivity probe used by the readiness indicator. */
  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }
}
