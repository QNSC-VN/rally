import { Inject, Injectable, Logger } from '@nestjs/common';
import type { JwtPayload } from '@platform';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { IQualityRepository, QUALITY_REPOSITORY } from '../domain/ports/quality.repository';
import type { DefectListResult, ListDefectsOptions } from '../domain/quality.types';

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
    opts: ListDefectsOptions = {},
  ): Promise<DefectListResult> {
    await this.projectsService.getProject(actor.workspaceId, projectId);

    /**
     * ONE scope, resolved ONCE, passed to BOTH queries (BA ruling 2026-08-17, read half; §5's Editor
     * row "Quality Defects View = Assigned Teams").
     *
     * Resolved here rather than inside each repository call so the grid and the KPI strip are provably
     * the same population: the metrics deliberately ignore the caller's filters, so the strip is the
     * one number nobody would notice was computed over every team's defects. Two resolutions could also
     * differ — the assignment cache has a 5-minute TTL — and a strip that outlived its own rows is the
     * fault CLAUDE.md records for Velocity's eligibility join.
     */
    const scope = await this.accessService.resolveTeamScope(
      actor.workspaceId,
      actor.sub,
      projectId,
    );

    const { rows, total } = await this.qualityRepo.listDefects(
      actor.workspaceId,
      projectId,
      opts,
      scope,
    );

    // Metrics — compute from ALL defects (not just the page), inside the same team scope as the page.
    const metrics = await this.qualityRepo.computeMetrics(actor.workspaceId, projectId, scope);

    return { metrics, data: rows, total };
  }
}
