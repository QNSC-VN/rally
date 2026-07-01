import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Auth, ApiCommonErrors } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@modules/identity';
import { NotificationsService } from '../../application/notifications.service';
import { ListNotificationsDto } from './dto/notification-request.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import type { Notification } from '../../domain/notification.types';

function toDto(n: Notification): NotificationResponseDto {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    resourceType: n.resourceType,
    resourceId: n.resourceId,
    isRead: n.isRead,
    readAt: n.readAt?.toISOString() ?? null,
    actorId: n.actorId,
    createdAt: n.createdAt.toISOString(),
  };
}

@ApiTags('notifications')
@Controller('notifications')
@Auth()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('unread-count')
  @ApiOperation({ summary: 'Get number of unread notifications for the current user' })
  @ApiResponse({ status: 200, schema: { properties: { count: { type: 'number' } } } })
  @ApiCommonErrors(401)
  async unreadCount(@CurrentUser() user: JwtPayload): Promise<{ count: number }> {
    const count = await this.notificationsService.getUnreadCount(user);
    return { count };
  }

  @Get()
  @ApiOperation({ summary: 'List notifications for the current user' })
  @ApiResponse({ status: 200, type: [NotificationResponseDto] })
  @ApiCommonErrors(401)
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListNotificationsDto,
  ): Promise<NotificationResponseDto[]> {
    const notifications = await this.notificationsService.listNotifications(
      user,
      Boolean(query.unreadOnly),
      Number(query.limit),
    );
    return notifications.map(toDto);
  }

  @Post(':id/read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Marked as read' })
  @ApiCommonErrors(401, 404)
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.notificationsService.markRead(user, id);
  }

  @Post('read-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 204, description: 'All notifications marked as read' })
  @ApiCommonErrors(401)
  async markAllRead(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.notificationsService.markAllRead(user);
  }
}
