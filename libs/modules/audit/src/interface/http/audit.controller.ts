import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth, ApiCommonErrors, ApiPagedResponse, CurrentUser } from '@platform';
import type { JwtPayload, PagedResult } from '@platform';
import { AuditService } from '../../application/audit.service';
import { AuditQueryDto } from './dto/audit-request.dto';
import { AuditLogResponseDto } from './dto/audit-response.dto';
import type { AuditLog } from '../../domain/audit.types';

function toDto(a: AuditLog): AuditLogResponseDto {
  return {
    id: a.id,
    actorId: a.actorId,
    actorEmail: a.actorEmail,
    action: a.action,
    resourceType: a.resourceType,
    resourceId: a.resourceId,
    projectId: a.projectId,
    changes: a.changes,
    metadata: a.metadata,
    occurredAt: a.occurredAt.toISOString(),
  };
}

@ApiTags('audit')
@Controller('audit-logs')
@Auth()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Query audit logs for the tenant' })
  @ApiPagedResponse(AuditLogResponseDto)
  @ApiCommonErrors(401, 422)
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: AuditQueryDto,
  ): Promise<PagedResult<AuditLogResponseDto>> {
    const result = await this.auditService.listAuditLogs(
      user,
      {
        actorId: query.actorId,
        resourceType: query.resourceType,
        resourceId: query.resourceId,
        projectId: query.projectId,
        action: query.action,
        from: query.from as Date | undefined,
        to: query.to as Date | undefined,
      },
      Number(query.limit),
      Number(query.offset),
    );
    return {
      data: result.data.map(toDto),
      pageInfo: result.pageInfo,
    };
  }
}
