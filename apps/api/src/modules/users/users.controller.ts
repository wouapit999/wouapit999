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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { ApiException } from '../../common/errors/api-exception.js';
import {
  AdminCreateUserDto,
  AdminUpdateUserDto,
  ListUsersQueryDto,
  StatusReasonDto,
  UpdateProfileDto,
} from './dto/user.dto.js';
import { UsersService } from './users.service.js';

function requireUserId(actor: AuthenticatedPrincipal): string {
  if (!actor.userId) throw ApiException.forbidden('This endpoint requires a user session');
  return actor.userId;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // --- Self-service (any authenticated user) -----------------------------------------------

  @Get('me')
  @ApiOperation({ summary: "Get the caller's profile" })
  me(@CurrentUser() actor: AuthenticatedPrincipal) {
    return this.users.getProfile(requireUserId(actor));
  }

  @Patch('me')
  @Audit({ action: 'users.profile.update', resource: 'User' })
  @ApiOperation({ summary: "Update the caller's profile" })
  updateMe(@CurrentUser() actor: AuthenticatedPrincipal, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(requireUserId(actor), dto);
  }

  // --- Administration ------------------------------------------------------------------------

  @Get()
  @Permissions('users:read')
  @ApiOperation({ summary: 'List users with filters and pagination' })
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @Permissions('users:read')
  @ApiOperation({ summary: 'Get a user' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post()
  @Permissions('users:write')
  @Audit('users.create')
  @ApiOperation({ summary: 'Create a user (admin realm by default) and e-mail an invitation' })
  create(@Body() dto: AdminCreateUserDto, @CurrentUser() actor: AuthenticatedPrincipal) {
    return this.users.create(dto, actor);
  }

  @Patch(':id')
  @Permissions('users:write')
  @Audit('users.update')
  @ApiOperation({ summary: 'Update user details' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.users.update(id, dto, actor);
  }

  @Post(':id/suspend')
  @Permissions('users:suspend')
  @Audit('users.suspend')
  @ApiOperation({ summary: 'Suspend a user and revoke their sessions' })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatusReasonDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.users.suspend(id, dto.reason, actor);
  }

  @Post(':id/reactivate')
  @Permissions('users:suspend')
  @Audit('users.reactivate')
  @ApiOperation({ summary: 'Reactivate a suspended or locked user' })
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatusReasonDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.users.reactivate(id, dto.reason, actor);
  }

  @Post(':id/unlock')
  @Permissions('users:unlock')
  @Audit('users.unlock')
  @ApiOperation({ summary: 'Clear a failed-login lockout' })
  unlock(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.unlock(id);
  }

  @Delete(':id')
  @Permissions('users:delete')
  @Audit('users.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a user' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatusReasonDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ): Promise<void> {
    await this.users.softDelete(id, dto.reason, actor);
  }
}
