import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { AuditQueryDto } from './dto/audit-query.dto.js';
import { AuditQueryService } from './audit-query.service.js';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @Permissions('audit:read')
  @ApiOperation({ summary: 'Search audit log entries' })
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }

  @Get(':id')
  @Permissions('audit:read')
  @ApiOperation({ summary: 'Get one audit log entry' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.audit.get(id);
  }
}
