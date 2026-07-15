import { Inject, Injectable } from '@nestjs/common';
import type { JwtPayload, CursorPayload, PagedResult } from '@platform';
import { PreconditionFailedException } from '@platform';
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
   * team-scoped) with the iteration already assigned — all in the SINGLE
   * transaction owned by `createWorkItem`.
   *
   * This is deliberately a create-and-assign in one step rather than
   * create-then-bulk-assign: creating an item inside an iteration is a *create*
   * action, so it requires only `work_item:create`. The previous two-step flow
   * additionally required `work_item:edit` (via the bulk-assignment path) and
   * was non-atomic — a caller with create-but-not-edit would leave an orphaned
   * backlog item and then fail, surfacing a confusing error. Because the item
   * inherits the iteration's own project (and team), iteration scope is
   * satisfied by construction, so no separate scope re-validation is needed.
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
    // Only stories and defects can live in an iteration (SRS P2.1). Enforced at
    // the DTO too; kept here as a service-layer invariant (defense in depth).
    if (input.type !== 'story' && input.type !== 'defect') {
      throw new PreconditionFailedException(
        'WORK_ITEM_NOT_BACKLOG_TYPE',
        'Only stories and defects can be assigned to an iteration',
      );
    }

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
        iterationId,
        // scheduleState defaults to 'defined' in the work-items service (SRS §9.4).
      },
    );

    return { workItemId: created.id, itemKey: created.itemKey };
  }
}
