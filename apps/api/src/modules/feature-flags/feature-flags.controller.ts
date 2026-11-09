import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { FlagKeyPipe } from './flag-key.pipe.js';
import { UpsertFeatureFlagDto } from './dto/feature-flag.dto.js';
import { FeatureFlagsService } from './feature-flags.service.js';

@ApiTags('feature-flags')
@ApiBearerAuth()
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get('evaluate')
  @ApiOperation({ summary: 'Evaluate every flag for the caller' })
  evaluate(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.flags.evaluateAll({
      userId: principal.userId,
      realm: principal.realm,
      email: principal.email,
      roles: principal.roles,
    });
  }

  @Get()
  @Permissions('feature-flags:read')
  @ApiOperation({ summary: 'List feature flags' })
  list() {
    return this.flags.list();
  }

  @Get(':key')
  @Permissions('feature-flags:read')
  @ApiOperation({ summary: 'Get a feature flag' })
  get(@Param('key', FlagKeyPipe) key: string) {
    return this.flags.get(key);
  }

  @Put(':key')
  @Permissions('feature-flags:write')
  @Audit({ action: 'feature-flags.upsert', resource: 'FeatureFlag', idParam: 'key' })
  @ApiOperation({ summary: 'Create or update a feature flag' })
  upsert(@Param('key', FlagKeyPipe) key: string, @Body() dto: UpsertFeatureFlagDto) {
    return this.flags.upsert(key, dto);
  }

  @Delete(':key')
  @Permissions('feature-flags:delete')
  @Audit({ action: 'feature-flags.delete', resource: 'FeatureFlag', idParam: 'key' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a feature flag (defaults apply afterwards)' })
  async remove(@Param('key', FlagKeyPipe) key: string): Promise<void> {
    await this.flags.remove(key);
  }
}
