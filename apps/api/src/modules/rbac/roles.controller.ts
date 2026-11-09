import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../common/decorators/audit.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto.js';
import { RolesService } from './roles.service.js';

@ApiTags('rbac')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @Permissions('roles:read')
  @ApiOperation({ summary: 'List roles with their permissions' })
  list() {
    return this.roles.list();
  }

  @Get(':id')
  @Permissions('roles:read')
  @ApiOperation({ summary: 'Get a role' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.get(id);
  }

  @Post()
  @Permissions('roles:write')
  @Audit('roles.create')
  @ApiOperation({ summary: 'Create a custom role' })
  create(@Body() dto: CreateRoleDto) {
    return this.roles.create(dto);
  }

  @Patch(':id')
  @Permissions('roles:write')
  @Audit('roles.update')
  @ApiOperation({ summary: 'Update a role (name, description, permission set)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(id, dto);
  }

  @Delete(':id')
  @Permissions('roles:delete')
  @Audit('roles.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a non-system role' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.roles.remove(id);
  }
}

@ApiTags('rbac')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @Permissions('permissions:read')
  @ApiOperation({ summary: 'List the permission catalogue' })
  list() {
    return this.roles.listPermissions();
  }
}
