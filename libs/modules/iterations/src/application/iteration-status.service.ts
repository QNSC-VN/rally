import { Inject, Injectable } from '@nestjs/common';
import type { JwtPayload, CursorPayload, PagedResult } from '@platform';
import { WorkItemsService } from '@modules/work-items';
import type { WorkItemType } from '@modules/work-items';
import { IterationsService } from './iterations.service';
import type { Iteration } from '../domain/iteration.types';
import {
  IIterationStatusRepository,
  ITERATION_STATUS_REPOSITORY,
} from '../domain/ports/iteration-status.repository';
import type {
  IterationStatusItem,
  IterationStatusFilters,
  IterationStatusMetrics,
} from '../domain/iteration-status.types';

export interface IterationStatusResult {
  iteration: Iteration;
  metrics: IterationStatusMetrics;
  items: PagedResult<IterationStatusItem>;
}

@Injectable()
export class IterationStatusService {
  constructor(
    @Inject(ITERATION_STATUS_REPOSITORY)
    private readonly statusRepo: IIterationStatusRepository,
    private readonly iterationsService: IterationsService,
    private readonly workItemsService: WorkItemsService,
  ) {}

  /** Percent helper — guards divide-by-zero (SRS §8: show 0% when denominator is 0). */
  private percent(numerator: number, denominator: number): number {
    if (!denominator) return 0;
    return Math.round((numerator / denominator) * 100);
  }

  /** Whole days from today (UTC date) to the iteration end; null if no end date. */
  private daysLeft(endDate: string | null): number | null {
    if (!endDate) return null;
    const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.round((end - today) / 86_400_000);
  }

  // ── Status read-model (P2-IS-03 / P2-IS-04) ───────────────────────────────

  async getStatus(
    actor: JwtPayload,
    iterationId: string,
    filters: IterationStatusFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<IterationStatusResult> {
    // Loads the iteration and authorizes the actor to view its project
    // (throws ITERATION_NOT_FOUND / 403 for a project the actor can't see).
    const iteration = await this.iterationsService.getIterationForView(actor, iterationId);

    const [raw, items] = await Promise.all([
      this.statusRepo.getMetrics(iterationId, actor.workspaceId),
      this.statusRepo.listItems(iterationId, actor.workspaceId, filters, args),
    ]);

    const plannedVelocity = iteration.plannedVelocity ?? 0;
    const metrics: IterationStatusMetrics = {
      plannedVelocity,
      acceptedPoints: raw.acceptedPoints,
      totalPlanEstimate: raw.totalPlanEstimate,
      plannedVelocityPercent: this.percent(raw.acceptedPoints, plannedVelocity),
      acceptedPercent: this.percent(raw.acceptedPoints, raw.totalPlanEstimate),
      daysLeft: this.daysLeft(iteration.endDate),
      defectCount: raw.defectCount,
      taskCount: raw.taskCount,
    };

    return { iteration, metrics, items };
  }

  // ── Create Story/Defect into the iteration (P2-IS-06) ─────────────────────

  /**
   * Create a new story or defect directly in the given iteration. The item is
   * created in the iteration's project (and team, when the iteration is
   * team-scoped) so it also appears in Backlog, then assigned to the iteration
   * through the validated assignment path.
   */
  async createItemInIteration(
    actor: JwtPayload,
    iterationId: string,
    input: {
      type: WorkItemType;
      title: string;
      assigneeId?: string;
      planEstimate?: number;
    },
  ): Promise<{ workItemId: string; itemKey: string }> {
    const iteration = await this.iterationsService.getIteration(actor.workspaceId, iterationId);

    const created = await this.workItemsService.createWorkItem(
      actor,
      iteration.projectId,
      input.type,
      input.title,
      {
        teamId: iteration.teamId ?? undefined,
        assigneeId: input.assigneeId,
        storyPoints: input.planEstimate,
        // scheduleState defaults to 'defined' in the work-items service (SRS §9.4).
      },
    );

    // Reuse the validated bulk-assignment path (project/team scope enforced).
    await this.workItemsService.bulkAssignIteration(
      actor,
      iteration.projectId,
      [created.id],
      iterationId,
    );

    return { workItemId: created.id, itemKey: created.itemKey };
  }
}
