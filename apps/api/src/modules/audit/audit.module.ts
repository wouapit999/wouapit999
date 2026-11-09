import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AuditController } from './audit.controller.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { AuditLogService } from './audit-log.service.js';
import { AuditQueryService } from './audit-query.service.js';

@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditLogService,
    AuditQueryService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditLogService],
})
export class AuditModule {}
