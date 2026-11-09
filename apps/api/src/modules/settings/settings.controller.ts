import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../common/decorators/audit.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { FlagKeyPipe } from '../feature-flags/flag-key.pipe.js';
import { UpsertSettingDto } from './dto/setting.dto.js';
import { SettingsService } from './settings.service.js';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Permissions('settings:read')
  @ApiOperation({ summary: 'List settings (secret values redacted)' })
  list() {
    return this.settings.list();
  }

  @Get(':key')
  @Permissions('settings:read')
  @ApiOperation({ summary: 'Get a setting (secret values redacted)' })
  get(@Param('key', FlagKeyPipe) key: string) {
    return this.settings.get(key);
  }

  @Get(':key/reveal')
  @Permissions('settings:read-secrets')
  @ApiOperation({ summary: 'Get a setting including its secret value' })
  reveal(@Param('key', FlagKeyPipe) key: string) {
    return this.settings.get(key, true);
  }

  @Put(':key')
  @Permissions('settings:write')
  @Audit({ action: 'settings.upsert', resource: 'Setting', idParam: 'key' })
  @ApiOperation({ summary: 'Create or update a setting' })
  upsert(@Param('key', FlagKeyPipe) key: string, @Body() dto: UpsertSettingDto) {
    return this.settings.upsert(key, dto);
  }

  @Delete(':key')
  @Permissions('settings:write')
  @Audit({ action: 'settings.delete', resource: 'Setting', idParam: 'key' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a setting' })
  async remove(@Param('key', FlagKeyPipe) key: string): Promise<void> {
    await this.settings.remove(key);
  }
}
