import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Auth, ApiCommonErrors } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@modules/identity';
import { ReportingService } from '../../application/reporting.service';
import { VELOCITY_DEFAULT_SPRINTS, VELOCITY_MAX_SPRINTS } from '../../domain/reporting.constants';
import type { SprintBurndownReport, VelocityReport } from '../../domain/reporting.types';

@ApiTags('reporting')
@Controller('reports')
@Auth()
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('sprints/:sprintId/burndown')
  @ApiOperation({ summary: 'Get sprint burndown chart data' })
  @ApiParam({ name: 'sprintId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        sprintId: { type: 'string' },
        points: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string' },
              remainingPoints: { type: 'number' },
              completedPoints: { type: 'number' },
              remainingItems: { type: 'number' },
              completedItems: { type: 'number' },
            },
          },
        },
      },
    },
  })
  @ApiCommonErrors(401, 404)
  async getBurndown(
    @CurrentUser() user: JwtPayload,
    @Param('sprintId', ParseUUIDPipe) sprintId: string,
  ): Promise<SprintBurndownReport> {
    return this.reportingService.getSprintBurndown(user, sprintId);
  }

  @Get('projects/:projectId/velocity')
  @ApiOperation({ summary: 'Get sprint velocity for a project' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'lastNSprints', required: false, type: Number, example: 6 })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        projectId: { type: 'string' },
        sprints: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sprintId: { type: 'string' },
              sprintName: { type: 'string' },
              completedPoints: { type: 'number' },
              completedItems: { type: 'number' },
            },
          },
        },
      },
    },
  })
  @ApiCommonErrors(401, 404)
  async getVelocity(
    @CurrentUser() user: JwtPayload,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('lastNSprints') lastNSprints?: string,
  ): Promise<VelocityReport> {
    const n = lastNSprints
      ? Math.min(Math.max(parseInt(lastNSprints, 10), 1), VELOCITY_MAX_SPRINTS)
      : VELOCITY_DEFAULT_SPRINTS;
    return this.reportingService.getVelocity(user, projectId, n);
  }
}
