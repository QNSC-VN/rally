import { Inject, Injectable } from '@nestjs/common';
import { NotFoundException } from '@platform';
import type { JwtPayload } from '@platform';
import { AccessService } from '@modules/access';
import { PERMISSION } from '@shared-kernel';
import { IReportingRepository, REPORTING_REPOSITORY } from '../domain/ports/reporting.repository';
import { VELOCITY_DEFAULT_SPRINTS } from '../domain/reporting.constants';
import type {
  SprintBurndownReport,
  SprintSnapshot,
  VelocityReport,
} from '../domain/reporting.types';

@Injectable()
export class ReportingService {
  constructor(
    @Inject(REPORTING_REPOSITORY) private readonly reportingRepo: IReportingRepository,
    private readonly accessService: AccessService,
  ) {}

  async getSprintBurndown(actor: JwtPayload, sprintId: string): Promise<SprintBurndownReport> {
    // Reports are project-scoped delivery data — enforce view at the sprint's
    // project, not just workspace membership (no cross-project report reads).
    const projectId = await this.reportingRepo.getSprintProjectId(actor.workspaceId, sprintId);
    if (!projectId) throw new NotFoundException('ITERATION_NOT_FOUND', 'Sprint not found');
    await this.accessService.assertProjectPermission(actor, projectId, PERMISSION.ITERATION_VIEW);

    const snapshots = await this.reportingRepo.getSprintSnapshots(actor.workspaceId, sprintId);

    return {
      sprintId,
      points: snapshots.map((s) => ({
        date: s.snapshotDate,
        remainingPoints: s.remainingPoints,
        completedPoints: s.completedPoints,
        remainingItems: s.totalItems - s.completedItems,
        completedItems: s.completedItems,
      })),
    };
  }

  async getVelocity(
    actor: JwtPayload,
    projectId: string,
    lastNSprints = VELOCITY_DEFAULT_SPRINTS,
  ): Promise<VelocityReport> {
    await this.accessService.assertProjectPermission(actor, projectId, PERMISSION.ITERATION_VIEW);
    const sprints = await this.reportingRepo.getVelocity(actor.workspaceId, projectId, lastNSprints);
    return { projectId, sprints };
  }

  /** Internal use — called by SnapshotCronService to materialise daily burndown data. */
  async upsertSnapshot(snapshot: Omit<SprintSnapshot, 'id' | 'createdAt'>): Promise<void> {
    return this.reportingRepo.upsertSnapshot(snapshot);
  }
}
