import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { AssignRolesDto } from './dto/role.dto.js';
import { UserRolesService } from './user-roles.service.js';

@ApiTags('rbac')
@ApiBearerAuth()
@Controller('users/:id/roles')
export class UserRolesController {
  constructor(private readonly userRoles: UserRolesService) {}

  @Get()
  @Permissions('users:read')
  @ApiOperation({ summary: "List a user's roles" })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.userRoles.get(id);
  }

  @Put()
  @Permissions('roles:assign')
  @Audit({ action: 'users.roles.replace', resource: 'User' })
  @ApiOperation({ summary: "Replace a user's role set" })
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRolesDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.userRoles.replace(id, dto.roleIds, actor);
  }

  @Post(':roleId')
  @Permissions('roles:assign')
  @Audit({ action: 'users.roles.assign', resource: 'User' })
  @ApiOperation({ summary: 'Assign one role to a user' })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.userRoles.assign(id, roleId, actor);
  }

  @Delete(':roleId')
  @Permissions('roles:assign')
  @Audit({ action: 'users.roles.unassign', resource: 'User' })
  @ApiOperation({ summary: 'Remove one role from a user' })
  unassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.userRoles.unassign(id, roleId, actor);
  }
}
