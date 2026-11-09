import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { ApiKeysService } from './api-keys.service.js';
import { CreateApiKeyDto } from './dto/api-key.dto.js';

@ApiTags('api-keys')
@ApiBearerAuth()
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @Permissions('api-keys:read')
  @ApiOperation({ summary: 'List service-account API keys (metadata only)' })
  list() {
    return this.apiKeys.list();
  }

  @Get(':id')
  @Permissions('api-keys:read')
  @ApiOperation({ summary: 'Get an API key (metadata only)' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.apiKeys.get(id);
  }

  @Post()
  @Permissions('api-keys:write')
  @Audit('api-keys.create')
  @ApiOperation({ summary: 'Create an API key; the plaintext secret is returned once' })
  create(@Body() dto: CreateApiKeyDto, @CurrentUser() actor: AuthenticatedPrincipal) {
    return this.apiKeys.create(dto, actor);
  }

  @Delete(':id')
  @Permissions('api-keys:revoke')
  @Audit('api-keys.revoke')
  @ApiOperation({ summary: 'Revoke an API key' })
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.apiKeys.revoke(id);
  }
}
