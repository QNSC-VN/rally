import { Inject, Injectable } from '@nestjs/common';
import type { JwtPayload } from '@platform';
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
  ) {}

  async getSprintBurndown(actor: JwtPayload, sprintId: string): Promise<SprintBurndownReport> {
    // Reports are project-scoped delivery data; the PolicyGuard enforces
    // iteration:view against the sprint's project (and 404s an unknown sprint)
    // before this runs — no cross-project report reads.
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
    // PolicyGuard enforces iteration:view on projectId before this runs.
    const sprints = await this.reportingRepo.getVelocity(actor.workspaceId, projectId, lastNSprints);
    return { projectId, sprints };
  }

  /** Internal use — called by SnapshotCronService to materialise daily burndown data. */
  async upsertSnapshot(snapshot: Omit<SprintSnapshot, 'id' | 'createdAt'>): Promise<void> {
    return this.reportingRepo.upsertSnapshot(snapshot);
  }
}
