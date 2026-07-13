import { Inject, Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { JwtPayload } from '@platform';
import { PERMISSION } from '@shared-kernel';
import { AccessService } from '@modules/access';
import { ProjectsService } from '@modules/projects';
import { IQualityRepository, QUALITY_REPOSITORY } from '../domain/ports/quality.repository';
import type { DefectListResult, DefectRow } from '../domain/quality.types';

@Injectable()
export class QualityService {
  private readonly logger = new Logger(QualityService.name);

  constructor(
    @Inject(QUALITY_REPOSITORY) private readonly qualityRepo: IQualityRepository,
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
  ) {}

  async getDefects(
    actor: JwtPayload,
    projectId: string,
    opts: {
      search?: string;
      severity?: string;
      environment?: string;
      priority?: string;
      scheduleState?: string;
      assigneeId?: string;
      releaseId?: string;
      rootCause?: string;
      resolution?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<DefectListResult> {
    await this.projectsService.getProject(actor.workspaceId, projectId);

    const { rows } = await this.qualityRepo.listDefects(actor.workspaceId, projectId, opts);

    // Metrics — compute from ALL defects (not just the page)
    const metrics = await this.qualityRepo.computeMetrics(actor.workspaceId, projectId);

    return { metrics, data: rows };
  }

  /**
   * Create a defect via the quality module.
   * Delegates to work-items service under the hood since defects are work items.
   */
  async createDefect(
    actor: JwtPayload,
    projectId: string,
    _input: {
      title: string;
      description?: string;
      priority?: string;
      severity?: string;
      foundInEnvironment?: string;
      foundInReleaseId?: string;
      assigneeId?: string;
      iterationId?: string;
      releaseId?: string;
      rootCause?: string;
      notes?: string;
    },
  ): Promise<DefectRow> {
    await this.accessService.assertProjectPermission(actor, projectId, PERMISSION.QUALITY_VIEW);
    // This is a placeholder — in a full implementation, this would delegate
    // to WorkItemsService.createWorkItem with type='defect'.
    // For now, throw to indicate the endpoint is wired but needs the work-items integration.
    throw new BadRequestException(
      'Use POST /v1/work-items with type=defect to create defects. The quality module provides read and metrics only.',
    );
  }
}
