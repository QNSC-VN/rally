import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@modules/identity';
import { AuthPolicy, RequirePermission } from '@modules/access';
import { ReportingService } from '../../application/reporting.service';
import {
  IterationBurndownQueryDto,
  ReleaseBurnupQueryDto,
  ReleaseTrackingQueryDto,
  TeamCapacityQueryDto,
  VelocityQueryDto,
} from './dto/reporting-request.dto';
import {
  IterationBurndownResponseDto,
  ReleaseBurnupResponseDto,
  ReleaseTrackingResponseDto,
  TeamCapacityResponseDto,
  VelocityResponseDto,
} from './dto/reporting-response.dto';
import type {
  IterationBurndownReport,
  ReleaseBurnupReport,
  ReleaseTrackingReport,
  TeamCapacityReport,
  VelocityReport,
} from '../../domain/reporting.types';

/**
 * Phase 6 read surface: the three reports on the `Reports` page plus Portfolio > Release
 * Tracking. Read-only — nothing here writes, and the daily snapshot jobs are internal
 * scheduled work with no HTTP route.
 *
 * Every route is gated on `report:view` resolved against `projectId` in the query string.
 * That is the Project half of §5.2's requirement; the Team half is enforced inside the
 * service by pushing the selected Team into each query rather than filtering afterwards.
 *
 * Routes are verbs of the report, not of the entity (`/reports/velocity`, not
 * `/projects/:id/velocity`): the scope is a query concern here — Project, Team and timebox
 * all come from the global context — and putting one of the three in the path would imply a
 * hierarchy the reports do not have.
 */
@ApiTags('reporting')
@Controller('reports')
@AuthPolicy()
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Get('iteration-burndown')
  @RequirePermission('report:view', { from: 'query', field: 'projectId' })
  @ApiOperation({
    summary: 'Iteration Burndown — frozen daily Remaining To Do, Accepted Points and Ideal',
  })
  @ApiResponse({ status: 200, type: IterationBurndownResponseDto })
  @ApiCommonErrors(400, 401, 403, 404)
  async getIterationBurndown(
    @CurrentUser() user: JwtPayload,
    @Query() query: IterationBurndownQueryDto,
  ): Promise<IterationBurndownReport> {
    return this.reporting.getIterationBurndown(user, {
      projectId: query.projectId,
      teamId: query.teamId,
      iterationId: query.iterationId,
    });
  }

  @Get('velocity')
  @RequirePermission('report:view', { from: 'query', field: 'projectId' })
  @ApiOperation({
    summary: 'Velocity — Accepted During / After / Not Accepted per completed timebox',
  })
  @ApiResponse({ status: 200, type: VelocityResponseDto })
  @ApiCommonErrors(400, 401, 403, 404)
  async getVelocity(
    @CurrentUser() user: JwtPayload,
    @Query() query: VelocityQueryDto,
  ): Promise<VelocityReport> {
    return this.reporting.getVelocity(user, {
      projectId: query.projectId,
      teamId: query.teamId,
      window: query.window,
    });
  }

  @Get('team-capacity')
  @RequirePermission('report:view', { from: 'query', field: 'projectId' })
  @ApiOperation({ summary: 'Team Capacity — a read-only projection of the Team Status hours' })
  @ApiResponse({ status: 200, type: TeamCapacityResponseDto })
  @ApiCommonErrors(400, 401, 403, 404)
  async getTeamCapacity(
    @CurrentUser() user: JwtPayload,
    @Query() query: TeamCapacityQueryDto,
  ): Promise<TeamCapacityReport> {
    return this.reporting.getTeamCapacity(user, {
      projectId: query.projectId,
      teamId: query.teamId,
      iterationId: query.iterationId,
    });
  }

  @Get('release-tracking')
  @RequirePermission('report:view', { from: 'query', field: 'projectId' })
  @ApiOperation({
    summary: 'Release Tracking — Direct / Derived / Unparented buckets, rows and totals',
  })
  @ApiResponse({ status: 200, type: ReleaseTrackingResponseDto })
  @ApiCommonErrors(400, 401, 403, 404)
  async getReleaseTracking(
    @CurrentUser() user: JwtPayload,
    @Query() query: ReleaseTrackingQueryDto,
  ): Promise<ReleaseTrackingReport> {
    return this.reporting.getReleaseTracking(user, {
      projectId: query.projectId,
      teamId: query.teamId,
      releaseId: query.releaseId,
      unit: query.unit,
      bucket: query.bucket,
    });
  }

  @Get('release-tracking/burnup')
  @RequirePermission('report:view', { from: 'query', field: 'projectId' })
  @ApiOperation({ summary: 'Release Tracking burnup — Accepted, Planned, Preliminary and Ideal' })
  @ApiResponse({ status: 200, type: ReleaseBurnupResponseDto })
  @ApiCommonErrors(400, 401, 403, 404)
  async getReleaseBurnup(
    @CurrentUser() user: JwtPayload,
    @Query() query: ReleaseBurnupQueryDto,
  ): Promise<ReleaseBurnupReport> {
    return this.reporting.getReleaseBurnup(user, {
      projectId: query.projectId,
      teamId: query.teamId,
      releaseId: query.releaseId,
      unit: query.unit,
    });
  }
}
