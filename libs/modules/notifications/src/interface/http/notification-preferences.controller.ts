/**
 * NotificationPreferencesController — manage per-type channel opt-in/out.
 *
 * Routes:
 *   GET    /notifications/preferences           — list all explicit preferences
 *   PUT    /notifications/preferences/:type     — upsert (body: { inApp?, email? })
 *   DELETE /notifications/preferences/:type     — reset to default (delete row)
 *
 * `type` must be '*' (wildcard master switch) or one of NotificationTemplateName
 * (e.g. 'WORK_ITEM_ASSIGNED') — the exact runtime value stored on notification
 * rows (see @platform/notifications/notification.templates). A mistyped or
 * wrongly-cased type now fails validation instead of silently creating a
 * preference row that never matches any real notification.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Auth, ApiCommonErrors } from '@platform';
import type { JwtPayload } from '@platform';
import { NOTIFICATION_TEMPLATE_NAMES } from '@platform/notifications';
import { CurrentUser } from '@modules/identity';
import { NotificationPreferencesService } from '../../application/notification-preferences.service';
import { UpsertPreferenceDto } from './dto/preference-request.dto';
import type { PreferenceResponseDto } from './dto/preference-response.dto';
import type { NotificationPreference } from '../../domain/notification-preference.types';

const VALID_TYPES = new Set<string>(['*', ...NOTIFICATION_TEMPLATE_NAMES]);

function assertValidType(type: string): void {
  if (!VALID_TYPES.has(type)) {
    throw new BadRequestException(
      `Unknown notification type '${type}'. Must be '*' or one of: ${NOTIFICATION_TEMPLATE_NAMES.join(', ')}`,
    );
  }
}

function toDto(p: NotificationPreference): PreferenceResponseDto {
  return {
    type: p.type,
    inApp: p.inApp,
    email: p.email,
    updatedAt: p.updatedAt.toISOString(),
  };
}

@ApiTags('notifications')
@Controller('notifications/preferences')
@Auth()
export class NotificationPreferencesController {
  constructor(private readonly prefsService: NotificationPreferencesService) {}

  @Get()
  @ApiOperation({
    summary: 'List notification preferences',
    description:
      'Returns all explicit preference rows for the current user. ' +
      'Types without a row default to both channels enabled. ' +
      "Use type='*' to set the global master switch.",
  })
  @ApiResponse({ status: 200 })
  @ApiCommonErrors(401)
  async list(@CurrentUser() user: JwtPayload): Promise<PreferenceResponseDto[]> {
    const prefs = await this.prefsService.listPreferences(user.workspaceId, user.sub);
    return prefs.map(toDto);
  }

  @Put(':type')
  @ApiOperation({
    summary: 'Upsert a notification preference',
    description:
      'Creates or updates the preference for a specific notification type. ' +
      "Use type='*' to set a global switch for all types.",
  })
  @ApiParam({ name: 'type', description: "Event type key, e.g. WORK_ITEM_ASSIGNED or '*'" })
  @ApiBody({ type: UpsertPreferenceDto })
  @ApiResponse({ status: 200 })
  @ApiCommonErrors(400, 401)
  async upsert(
    @CurrentUser() user: JwtPayload,
    @Param('type') type: string,
    @Body() body: UpsertPreferenceDto,
  ): Promise<PreferenceResponseDto> {
    assertValidType(type);
    const pref = await this.prefsService.upsert({
      workspaceId: user.workspaceId,
      userId: user.sub,
      type,
      inApp: body.inApp,
      email: body.email,
    });
    return toDto(pref);
  }

  @Delete(':type')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Reset a notification preference to default',
    description: 'Deletes the explicit preference row; the type reverts to both channels enabled.',
  })
  @ApiParam({ name: 'type', description: "Event type key, e.g. WORK_ITEM_ASSIGNED or '*'" })
  @ApiResponse({ status: 204, description: 'Reset to default' })
  @ApiCommonErrors(400, 401)
  async reset(@CurrentUser() user: JwtPayload, @Param('type') type: string): Promise<void> {
    assertValidType(type);
    await this.prefsService.reset(user.workspaceId, user.sub, type);
  }
}
