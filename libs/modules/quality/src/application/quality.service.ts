import { Inject, Injectable, Logger } from '@nestjs/common';
import type { JwtPayload } from '@platform';
import { ProjectsService } from '@modules/projects';
import { IQualityRepository, QUALITY_REPOSITORY } from '../domain/ports/quality.repository';
import type { DefectListResult } from '../domain/quality.types';

@Injectable()
export class QualityService {
  private readonly logger = new Logger(QualityService.name);

  constructor(
    @Inject(QUALITY_REPOSITORY) private readonly qualityRepo: IQualityRepository,
    private readonly projectsService: ProjectsService,
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
      defectState?: string;
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
}
