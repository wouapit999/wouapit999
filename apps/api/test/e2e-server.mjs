/**
 * Boots the API through the Nest testing module with PrismaService replaced by a stub, then
 * prints the listening port as JSON on stdout. Spawned by app.e2e-spec.ts.
 *
 * It runs in a plain Node process (not inside Jest's module loader) because Jest on Node < 24.9
 * cannot `require()` ES modules, which the CommonJS `@nestjs/throttler` does for the ESM
 * `@nestjs/common` v12. Node itself handles that fine.
 */
import { Test } from '@nestjs/testing';

import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/bootstrap.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';

const databaseUnavailable = () => {
  throw new Error('database unavailable in e2e');
};

/** No Postgres in e2e: probes fail (readiness 503), audit writes are swallowed. */
const prismaStub = {
  client: {
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $queryRaw: async () => databaseUnavailable(),
    auditLog: { create: async () => null },
    outbox: { count: async () => 0 },
  },
  ping: async () => databaseUnavailable(),
  onModuleInit: async () => undefined,
  onModuleDestroy: async () => undefined,
};

const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(PrismaService)
  .useValue(prismaStub)
  .compile();

const app = moduleRef.createNestApplication({ bufferLogs: true });
configureApp(app);
await app.listen(0, '127.0.0.1');

const address = app.getHttpServer().address();
process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);

let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  app.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('disconnect', shutdown);
