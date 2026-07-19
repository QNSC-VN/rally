import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors, parseSort } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@modules/identity';
import { AuthProjectScoped } from '@modules/access';
import { RequireProjectPermission } from '@modules/access';
import { QualityService } from '../../application/quality.service';
import { DEFECT_SORT_FIELDS } from '../../domain/quality.types';
import { DefectQueryDto } from './dto/defect-query.dto';

@ApiTags('quality')
@Controller('quality')
@AuthProjectScoped()
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  @Get('defects')
  @RequireProjectPermission('quality:view', 'query', 'projectId')
  @ApiOperation({ summary: 'List defects with metrics for a project' })
  @ApiCommonErrors(400, 401, 403, 404)
  listDefects(@CurrentUser() user: JwtPayload, @Query() query: DefectQueryDto) {
    const sort = parseSort(query.sort, DEFECT_SORT_FIELDS);
    return this.qualityService.getDefects(user, query.projectId, {
      search: query.search,
      severity: query.severity,
      environment: query.environment,
      priority: query.priority,
      scheduleState: query.scheduleState,
      assigneeId: query.assigneeId,
      releaseId: query.releaseId,
      rootCause: query.rootCause,
      resolution: query.resolution,
      defectState: query.defectState,
      sortBy: sort?.sortBy,
      sortDirection: sort?.sortDirection,
      limit: query.limit,
    });
  }
}
