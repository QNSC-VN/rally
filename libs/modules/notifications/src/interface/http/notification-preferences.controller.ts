/**
 * NotificationPreferencesController — manage per-type channel opt-in/out.
 *
 * Routes:
 *   GET    /notifications/preferences           — list all explicit preferences
 *   PUT    /notifications/preferences/:type     — upsert (body: { inApp?, email? })
 *   DELETE /notifications/preferences/:type     — reset to default (delete row)
 *
 * type can be '*' (wildcard master switch) or a specific event type
 * (e.g. 'work_item.assigned', 'sprint.started').
 */
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Auth, ApiCommonErrors } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@modules/identity';
import { NotificationPreferencesService } from '../../application/notification-preferences.service';
import { UpsertPreferenceDto } from './dto/preference-request.dto';
import type { PreferenceResponseDto } from './dto/preference-response.dto';
import type { NotificationPreference } from '../../domain/notification-preference.types';

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
    const prefs = await this.prefsService.listPreferences(user.tenantId, user.sub);
    return prefs.map(toDto);
  }

  @Put(':type')
  @ApiOperation({
    summary: 'Upsert a notification preference',
    description:
      'Creates or updates the preference for a specific notification type. ' +
      "Use type='*' to set a global switch for all types.",
  })
  @ApiParam({ name: 'type', description: 'Event type key, e.g. work_item.assigned or *' })
  @ApiBody({ type: UpsertPreferenceDto })
  @ApiResponse({ status: 200 })
  @ApiCommonErrors(400, 401)
  async upsert(
    @CurrentUser() user: JwtPayload,
    @Param('type') type: string,
    @Body() body: UpsertPreferenceDto,
  ): Promise<PreferenceResponseDto> {
    const pref = await this.prefsService.upsert({
      tenantId: user.tenantId,
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
  @ApiParam({ name: 'type', description: 'Event type key, e.g. work_item.assigned or *' })
  @ApiResponse({ status: 204, description: 'Reset to default' })
  @ApiCommonErrors(401)
  async reset(@CurrentUser() user: JwtPayload, @Param('type') type: string): Promise<void> {
    await this.prefsService.reset(user.tenantId, user.sub, type);
  }
}
