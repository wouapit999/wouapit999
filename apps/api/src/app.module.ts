import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import { HTTP_HEADERS } from '@bi-rem/shared';

import { ProblemDetailsFilter } from './common/filters/problem-details.filter.js';
import { type AppConfig, validateEnv } from './config/env.js';
import { ApiKeysModule } from './modules/api-keys/api-keys.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard.js';
import { CryptoModule } from './modules/crypto/crypto.module.js';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module.js';
import { MonitoringModule } from './modules/monitoring/monitoring.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { PermissionsGuard } from './modules/rbac/permissions.guard.js';
import { RbacModule } from './modules/rbac/rbac.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';

const SENSITIVE_HEADERS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
];

function requestId(req: IncomingMessage): string {
  const header = req.headers[HTTP_HEADERS.requestId];
  return (Array.isArray(header) ? header[0] : header) ?? 'unknown';
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env', '../../.env'],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          // The request-context middleware has already normalised/echoed x-request-id.
          genReqId: requestId,
          customProps: (req) => ({ correlationId: requestId(req) }),
          redact: { paths: SENSITIVE_HEADERS, censor: '[REDACTED]' },
          autoLogging: {
            ignore: (req) => req.url?.startsWith('/health') === true || req.url === '/metrics',
          },
          ...(config.get('NODE_ENV', { infer: true }) === 'development'
            ? {
                transport: { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
              }
            : {}),
        },
      }),
    }),
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    CryptoModule,
    OutboxModule,
    AuditModule,
    RbacModule,
    NotificationsModule,
    ApiKeysModule,
    FeatureFlagsModule,
    SettingsModule,
    AuthModule,
    UsersModule,
    MonitoringModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    // Guard order matters: rate limit → authentication → authorization.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
