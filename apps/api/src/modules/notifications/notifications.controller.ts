import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedPrincipal } from '../../common/auth/principal.js';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { ApiException } from '../../common/errors/api-exception.js';
import {
  ListNotificationsQueryDto,
  SendNotificationDto,
  UpdatePreferencesDto,
  UpsertTemplateDto,
} from './dto/notification.dto.js';
import { NotificationService } from './notification.service.js';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  // --- Self-service -----------------------------------------------------------------------

  @Get('me')
  @ApiOperation({ summary: "List the caller's notifications" })
  listMine(
    @Query() query: ListNotificationsQueryDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.notifications.list(query, requireUserId(actor));
  }

  @Post('me/:id/read')
  @Audit({ action: 'notifications.read', resource: 'Notification' })
  @ApiOperation({ summary: 'Mark one of the caller’s notifications as read' })
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedPrincipal) {
    return this.notifications.markRead(id, requireUserId(actor));
  }

  @Get('preferences')
  @ApiOperation({ summary: "Get the caller's channel preferences" })
  preferences(@CurrentUser() actor: AuthenticatedPrincipal) {
    return this.notifications.getPreferences(requireUserId(actor));
  }

  @Put('preferences')
  @Audit({ action: 'notifications.preferences.update', resource: 'NotificationPreference' })
  @ApiOperation({ summary: "Update the caller's channel preferences" })
  updatePreferences(
    @Body() dto: UpdatePreferencesDto,
    @CurrentUser() actor: AuthenticatedPrincipal,
  ) {
    return this.notifications.updatePreferences(requireUserId(actor), dto.preferences);
  }

  // --- Admin ------------------------------------------------------------------------------

  @Get('templates')
  @Permissions('notification-templates:read')
  @ApiOperation({ summary: 'List notification templates' })
  listTemplates() {
    return this.notifications.listTemplates();
  }

  @Put('templates')
  @Permissions('notification-templates:write')
  @Audit({ action: 'notification-templates.upsert', resource: 'NotificationTemplate' })
  @ApiOperation({ summary: 'Create or update a template (by key + channel + locale)' })
  upsertTemplate(@Body() dto: UpsertTemplateDto) {
    return this.notifications.upsertTemplate(dto);
  }

  @Get('queue')
  @Permissions('system:read')
  @ApiOperation({ summary: 'Notification queue statistics' })
  queue() {
    return this.notifications.queueStats();
  }

  @Get()
  @Permissions('notifications:read')
  @ApiOperation({ summary: 'List notifications across users (admin)' })
  list(@Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(query);
  }

  @Post()
  @Permissions('notifications:send')
  @Audit({ action: 'notifications.send', resource: 'Notification' })
  @ApiOperation({ summary: 'Send an ad-hoc templated notification to a user (admin)' })
  send(@Body() dto: SendNotificationDto) {
    return this.notifications.send({
      userId: dto.userId,
      channel: dto.channel,
      templateKey: dto.templateKey,
      variables: dto.variables,
      force: true,
    });
  }
}

function requireUserId(actor: AuthenticatedPrincipal): string {
  if (!actor.userId) throw ApiException.forbidden('This endpoint requires a user session');
  return actor.userId;
}
