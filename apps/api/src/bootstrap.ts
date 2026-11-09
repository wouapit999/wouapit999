import helmet from 'helmet';
import { type INestApplication, ValidationPipe, type ValidationError } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { API_PREFIX, type FieldError, HTTP_HEADERS } from '@bi-rem/shared';

import { AppModule } from './app.module.js';
import { requestContextMiddleware } from './common/context/request-context.middleware.js';
import { ApiException } from './common/errors/api-exception.js';
import type { AppConfig } from './config/env.js';

/** Builds the fully configured Nest application (used by main.ts and the e2e tests). */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  configureApp(app);
  return app;
}

export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService<AppConfig, true>);
  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContextMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: config.get('isProduction', { infer: true }) ? undefined : false,
    }),
  );
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      HTTP_HEADERS.requestId,
      HTTP_HEADERS.apiKey,
      'Accept-Language',
    ],
    exposedHeaders: [HTTP_HEADERS.requestId],
    maxAge: 600,
  });

  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ''), {
    exclude: ['health', 'health/live', 'health/ready', 'metrics', 'docs', 'docs-json'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
      exceptionFactory: (errors) =>
        ApiException.badRequest('Request validation failed', flattenValidationErrors(errors)),
    }),
  );

  setupSwagger(app, config);
  app.enableShutdownHooks();
}

export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  const out: FieldError[] = [];
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    for (const [code, message] of Object.entries(error.constraints ?? {})) {
      out.push({ path, message, code });
    }
    if (error.children?.length) out.push(...flattenValidationErrors(error.children, path));
  }
  return out;
}

function setupSwagger(app: INestApplication, config: ConfigService<AppConfig, true>): void {
  const builder = new DocumentBuilder()
    .setTitle('BI-Rem API')
    .setDescription(
      'Pan-African remittance platform — Phase 1 foundation API (auth, RBAC, audit, notifications).',
    )
    .setVersion('1.0.0')
    .addServer(config.get('API_BASE_URL', { infer: true }))
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addApiKey({ type: 'apiKey', in: 'header', name: HTTP_HEADERS.apiKey }, 'api-key')
    .build();
  const document = SwaggerModule.createDocument(app, builder);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'BI-Rem API docs',
  });
}

export async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get(ConfigService<AppConfig, true>);
  const logger = app.get(Logger);
  const port = config.get('API_PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  logger.log(
    `BI-Rem API listening on ${config.get('API_BASE_URL', { infer: true })} (docs at /docs)`,
    'Bootstrap',
  );
}
