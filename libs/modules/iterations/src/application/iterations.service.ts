import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { and, eq, isNull, inArray, sql } from 'drizzle-orm';
import { NotFoundException, PreconditionFailedException, InjectDrizzle } from '@platform';
import type { JwtPayload, CursorPayload, PagedResult, DrizzleDB } from '@platform';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { PERMISSION } from '@shared-kernel';
import { workItems } from '../../../../../db/schema/work';
import { acceptedScheduleStatesSql } from '../../../../../db/schema/enums';
import { IIterationRepository, ITERATION_REPOSITORY } from '../domain/ports/iteration.repository';
import {
  IIterationActivityLogRepository,
  ITERATION_ACTIVITY_LOG_REPOSITORY,
} from '../domain/ports/iteration-activity-log.repository';
import { diffIteration } from './iteration-activity-diff';
import type {
  Iteration,
  IterationOption,
  IterationFilters,
  UpdateIterationInput,
} from '../domain/iteration.types';
import type {
  ActivityChange,
  CreateIterationActivityLogInput,
  IterationActivityAction,
  IterationActivityLog,
} from '../domain/activity-log.types';

/** Walk an error's `.cause` chain looking for a PG unique-violation (code 23505). */
function isDuplicateKeyError(err: unknown): boolean {
  let current: unknown = err;
  while (true) {
    if (current && typeof current === 'object' && 'code' in current) {
      const c = (current as Record<string, unknown>).code;
      if (c === '23505') return true;
    }
    if (current && typeof current === 'object' && 'cause' in current) {
      current = current.cause;
    } else {
      return false;
    }
  }
}

@Injectable()
export class IterationsService {
  private readonly logger = new Logger(IterationsService.name);

  constructor(
    @Inject(ITERATION_REPOSITORY) private readonly iterationRepo: IIterationRepository,
    @Inject(ITERATION_ACTIVITY_LOG_REPOSITORY)
    private readonly activityRepo: IIterationActivityLogRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
  ) {}

  // ── Revision History (activity log) ─────────────────────────────────────────

  private buildActivity(
    iteration: Iteration,
    actorId: string | null,
    action: IterationActivityAction,
    changes: ActivityChange | null,
  ): CreateIterationActivityLogInput {
    return {
      id: uuidv7(),
      workspaceId: iteration.workspaceId,
      projectId: iteration.projectId,
      iterationId: iteration.id,
      actorId,
      action,
      changes,
    };
  }

  /** Best-effort append — a revision-log failure must never fail the mutation. */
  private async appendActivity(inputs: CreateIterationActivityLogInput[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      await this.activityRepo.appendMany(inputs);
    } catch (err) {
      this.logger.warn({ err }, 'Failed to write iteration activity log');
    }
  }

  /** Newest-first revision history for one iteration (project-view gated). */
  async getIterationActivity(
    actor: JwtPayload,
    id: string,
    args: { limit: number; offset: number },
  ): Promise<{ items: IterationActivityLog[]; total: number }> {
    await this.getIterationForView(actor, id);
    return this.activityRepo.listByIteration(id, actor.workspaceId, args);
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async listIterations(
    actor: JwtPayload,
    projectId: string,
    filters: IterationFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Iteration>> {
    await this.projectsService.getProject(actor.workspaceId, projectId);
    return this.iterationRepo.listByProject(projectId, actor.workspaceId, filters, args);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createIteration(
    actor: JwtPayload,
    projectId: string,
    name: string,
    opts: {
      teamId?: string;
      goal?: string;
      theme?: string;
      notes?: string;
      state?: import('../domain/iteration.types').IterationState;
      startDate?: string;
      endDate?: string;
      plannedVelocity?: number;
    } = {},
  ): Promise<Iteration> {
    await this.projectsService.getProject(actor.workspaceId, projectId);

    if (opts.teamId) {
      await this.projectsService.assertTeamLinkedToProject(
        actor.workspaceId,
        projectId,
        opts.teamId,
      );
    }
    this.assertDateRange(opts.startDate, opts.endDate);

    // iterationKey reservation reads MAX(existing) + 1 (not atomic under
    // concurrent creates) and iterations can be hard-deleted, so a collision
    // on uq_iterations_key is possible; retry once with a freshly computed key.
    const MAX_KEY_RETRIES = 2;
    let iteration: Iteration | undefined;
    let lastErr: unknown;

    for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt++) {
      const keyNumber = await this.iterationRepo.nextKeyNumber(projectId, actor.workspaceId);

      try {
        iteration = await this.iterationRepo.create({
          id: uuidv7(),
          workspaceId: actor.workspaceId,
          projectId,
          teamId: opts.teamId ?? null,
          iterationKey: `IT-${keyNumber}`,
          name,
          goal: opts.goal,
          theme: opts.theme,
          notes: opts.notes,
          state: opts.state,
          startDate: opts.startDate,
          endDate: opts.endDate,
          plannedVelocity: opts.plannedVelocity,
        });
        break; // success — exit retry loop
      } catch (err: unknown) {
        lastErr = err;
        if (isDuplicateKeyError(err) && attempt < MAX_KEY_RETRIES - 1) {
          this.logger.warn(
            { projectId, attempt: attempt + 1 },
            'Duplicate iteration key on create — retrying with next key',
          );
          continue;
        }
        throw err; // not a duplicate-key error or last attempt — re-throw
      }
    }

    if (!iteration) throw lastErr;

    this.logger.log(
      { iterationId: iteration.id, projectId, userId: actor.sub },
      'Iteration created',
    );
    await this.appendActivity([
      this.buildActivity(iteration, actor.sub, 'iteration.created', null),
    ]);
    return iteration;
  }

  // ── Assignment options (P2-IT-10) — lightweight picker feed ─────────────────

  async getAssignmentOptions(
    actor: JwtPayload,
    projectId: string,
    teamId?: string,
  ): Promise<IterationOption[]> {
    await this.projectsService.getProject(actor.workspaceId, projectId);
    return this.iterationRepo.listAssignmentOptions(projectId, actor.workspaceId, teamId);
  }

  // ── Get ───────────────────────────────────────────────────────────────────

  async getIteration(workspaceId: string, id: string): Promise<Iteration> {
    const iteration = await this.iterationRepo.findById(id);
    if (!iteration || iteration.workspaceId !== workspaceId) {
      throw new NotFoundException('ITERATION_NOT_FOUND', 'Iteration not found');
    }
    return iteration;
  }

  /**
   * Load an iteration and authorize the actor to VIEW its project. Use at read
   * entry points (controller GET, status read) so a project-scoped viewer only
   * sees iterations in projects they can access; a workspace-wide iteration:view
   * fast-paths inside assertProjectPermission.
   */
  async getIterationForView(actor: JwtPayload, id: string): Promise<Iteration> {
    const iteration = await this.getIteration(actor.workspaceId, id);
    await this.accessService.assertProjectPermission(
      actor,
      iteration.projectId,
      PERMISSION.ITERATION_VIEW,
    );
    return iteration;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateIteration(
    actor: JwtPayload,
    id: string,
    input: UpdateIterationInput,
  ): Promise<Iteration> {
    const current = await this.getIteration(actor.workspaceId, id);
    // Per-project check against THIS iteration's project.
    await this.accessService.assertProjectPermission(
      actor,
      current.projectId,
      PERMISSION.ITERATION_EDIT,
    );

    // Team must remain linked to the iteration's project.
    if (input.teamId) {
      await this.projectsService.assertTeamLinkedToProject(
        actor.workspaceId,
        current.projectId,
        input.teamId,
      );
    }

    // Validate the resulting date range (fall back to current values).
    const startDate = input.startDate !== undefined ? input.startDate : current.startDate;
    const endDate = input.endDate !== undefined ? input.endDate : current.endDate;
    this.assertDateRange(startDate ?? undefined, endDate ?? undefined);

    // State is a lifecycle transition, not a free-form field. Route it through
    // the SAME gated actions as commit/accept so PATCH cannot bypass the F1 rule
    // (e.g. set state='accepted' while items are still open). Forward transitions
    // only; no reverse-force (BA F1).
    let stateResult: Iteration | undefined;
    if (input.state !== undefined && input.state !== current.state) {
      if (current.state === 'planning' && input.state === 'committed') {
        stateResult = await this.commitIteration(actor, id);
      } else if (current.state === 'committed' && input.state === 'accepted') {
        stateResult = await this.acceptIteration(actor, id);
      } else {
        throw new PreconditionFailedException(
          'ITERATION_INVALID_STATE_TRANSITION',
          `Invalid iteration state transition: ${current.state} → ${input.state}`,
        );
      }
    }

    // Apply the remaining (non-state) field updates, if any.
    const fields = { ...input };
    delete fields.state;
    if (Object.keys(fields).length > 0) {
      const updated = await this.iterationRepo.update(id, fields);
      await this.appendActivity(
        diffIteration(current, fields).map((e) =>
          this.buildActivity(updated, actor.sub, 'iteration.updated', e.change),
        ),
      );
      return updated;
    }
    return stateResult ?? current;
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteIteration(actor: JwtPayload, id: string): Promise<void> {
    const iteration = await this.getIteration(actor.workspaceId, id);
    await this.accessService.assertProjectPermission(
      actor,
      iteration.projectId,
      PERMISSION.ITERATION_DELETE,
    );
    if (iteration.state !== 'planning') {
      throw new PreconditionFailedException(
        'ITERATION_NOT_PLANNING',
        'Only iterations in the Planning state can be deleted',
      );
    }
    await this.iterationRepo.delete(id);
    this.logger.log({ iterationId: id }, 'Iteration deleted');
  }

  // ── Commit (planning → committed) ───────────────────────────────────────────

  async commitIteration(actor: JwtPayload, id: string): Promise<Iteration> {
    const iteration = await this.getIteration(actor.workspaceId, id);
    await this.accessService.assertProjectPermission(
      actor,
      iteration.projectId,
      PERMISSION.ITERATION_EDIT,
    );

    if (iteration.state !== 'planning') {
      throw new PreconditionFailedException(
        'ITERATION_NOT_PLANNING',
        'Iteration is not in the Planning state',
      );
    }

    const updated = await this.iterationRepo.update(id, { state: 'committed' });
    this.logger.log({ iterationId: id }, 'Iteration committed');
    await this.appendActivity([
      this.buildActivity(updated, actor.sub, 'iteration.committed', {
        field: 'state',
        old: 'planning',
        new: 'committed',
      }),
    ]);
    return updated;
  }

  // ── Accept (committed → accepted) ───────────────────────────────────────────
  // BA F1: manual-first. An iteration can be accepted ONLY when it has at least
  // one assigned Story/Defect and EVERY assigned Story/Defect is in an accepted
  // state. Accept does NOT move unfinished items — use rolloverUnfinished() for
  // that, as a separate, explicit action.

  async acceptIteration(actor: JwtPayload, id: string): Promise<Iteration> {
    const workspaceId = actor.workspaceId;
    const iteration = await this.getIteration(workspaceId, id);
    await this.accessService.assertProjectPermission(
      actor,
      iteration.projectId,
      PERMISSION.ITERATION_EDIT,
    );

    if (iteration.state !== 'committed') {
      throw new PreconditionFailedException(
        'ITERATION_NOT_COMMITTED',
        'Only a committed iteration can be accepted',
      );
    }

    const [agg] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        allAccepted: sql<boolean>`bool_and(${workItems.scheduleState} in (${acceptedScheduleStatesSql()}))`,
      })
      .from(workItems)
      .where(
        and(
          eq(workItems.iterationId, id),
          eq(workItems.workspaceId, workspaceId),
          inArray(workItems.type, ['story', 'defect']),
          isNull(workItems.deletedAt),
        ),
      );

    if (Number(agg?.total ?? 0) === 0) {
      throw new PreconditionFailedException(
        'ITERATION_EMPTY',
        'Cannot accept an iteration with no assigned Story or Defect items',
      );
    }
    if (agg?.allAccepted !== true) {
      throw new PreconditionFailedException(
        'ITERATION_NOT_ALL_ACCEPTED',
        'All assigned Story and Defect items must be Accepted before the iteration can be accepted',
      );
    }

    const updated = await this.iterationRepo.update(id, {
      state: 'accepted',
      completedAt: new Date(),
    });
    this.logger.log({ iterationId: id }, 'Iteration accepted');
    await this.appendActivity([
      this.buildActivity(updated, actor.sub, 'iteration.accepted', {
        field: 'state',
        old: 'committed',
        new: 'accepted',
      }),
    ]);
    return updated;
  }

  // ── Rollover — move unfinished items out (explicit, separate from accept) ────
  // Rollover is the mirror of the accept-gate: it moves out exactly the items
  // that BLOCK acceptance — the Story/Defect items NOT yet accepted
  // (schedule_state ∉ {accepted, release}, the SAME D1 predicate the accept-gate
  // uses). After a rollover only accepted items remain, so the iteration can be
  // accepted. (Burndown's board-'done' D2 dimension is a reporting concern and
  // is deliberately NOT used here — the two definitions of "finished" must not
  // diverge.) Moves to a target iteration (same project) or back to the backlog
  // (null). Returns the number of items moved.

  async rolloverUnfinished(
    actor: JwtPayload,
    id: string,
    opts: { moveToIterationId?: string } = {},
  ): Promise<{ movedCount: number }> {
    const workspaceId = actor.workspaceId;
    const iteration = await this.getIteration(workspaceId, id);
    await this.accessService.assertProjectPermission(
      actor,
      iteration.projectId,
      PERMISSION.ITERATION_EDIT,
    );

    if (opts.moveToIterationId) {
      const target = await this.getIteration(workspaceId, opts.moveToIterationId);
      if (target.projectId !== iteration.projectId) {
        throw new PreconditionFailedException(
          'ITERATION_PROJECT_MISMATCH',
          'Target iteration must belong to the same project',
        );
      }
    }

    const moved = await this.db
      .update(workItems)
      .set({ iterationId: opts.moveToIterationId ?? null, updatedAt: new Date() })
      .where(
        and(
          eq(workItems.iterationId, id),
          eq(workItems.workspaceId, workspaceId),
          inArray(workItems.type, ['story', 'defect']),
          isNull(workItems.deletedAt),
          sql`${workItems.scheduleState} not in (${acceptedScheduleStatesSql()})`,
        ),
      )
      .returning({ id: workItems.id });

    this.logger.log(
      {
        iterationId: id,
        moveToIterationId: opts.moveToIterationId ?? null,
        movedCount: moved.length,
      },
      'Iteration unfinished items rolled over',
    );
    return { movedCount: moved.length };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private assertDateRange(startDate?: string, endDate?: string): void {
    if (startDate && endDate && startDate > endDate) {
      throw new PreconditionFailedException(
        'ITERATION_INVALID_DATE_RANGE',
        'Start date must be before or equal to end date',
      );
    }
  }
}
