import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { and, eq, isNull, inArray, sql } from 'drizzle-orm';
import {
  NotFoundException,
  PreconditionFailedException,
  InjectDrizzle,
  isDuplicateKeyError,
} from '@platform';
import type { JwtPayload, CursorPayload, PagedResult, DrizzleDB } from '@platform';
import { ProjectsService } from '@modules/projects';
import { WorkItemsService } from '@modules/work-items';
import { AccessService } from '@modules/access';
import { workItems } from '../../../../../db/schema/work';
import { acceptedScheduleStatesSql } from '../../../../../db/schema/enums';
import { IIterationRepository, ITERATION_REPOSITORY } from '../domain/ports/iteration.repository';
import {
  ActivityLogger,
  type ActivityChange,
  type ActivityLog,
  type CreateActivityInput,
} from '@modules/activity';
import { diffIteration } from './iteration-activity-diff';
import type {
  Iteration,
  IterationOption,
  IterationFilters,
  UpdateIterationInput,
} from '../domain/iteration.types';

@Injectable()
export class IterationsService {
  private readonly logger = new Logger(IterationsService.name);

  constructor(
    @Inject(ITERATION_REPOSITORY) private readonly iterationRepo: IIterationRepository,
    private readonly activity: ActivityLogger,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
    private readonly workItemsService: WorkItemsService,
  ) {}

  // ── Revision History (activity log) ─────────────────────────────────────────

  private buildActivity(
    iteration: Iteration,
    actorId: string | null,
    action: string,
    changes: ActivityChange | null,
  ): CreateActivityInput {
    return this.activity.build(
      {
        workspaceId: iteration.workspaceId,
        projectId: iteration.projectId,
        entityType: 'iteration',
        entityId: iteration.id,
      },
      actorId,
      action,
      changes,
    );
  }

  /** Best-effort append — a revision-log failure must never fail the mutation. */
  private async appendActivity(inputs: CreateActivityInput[]): Promise<void> {
    await this.activity.logSafe(inputs);
  }

  /** Newest-first revision history for one iteration (project-view gated). */
  async getIterationActivity(
    actor: JwtPayload,
    id: string,
    args: { limit: number; offset: number },
  ): Promise<{ items: ActivityLog[]; total: number }> {
    await this.getIterationForView(actor, id);
    const page = Math.floor(args.offset / args.limit) + 1;
    const res = await this.activity.listFor(id, actor.workspaceId, page, args.limit);
    return { items: res.data, total: res.total };
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async listIterations(
    actor: JwtPayload,
    projectId: string,
    filters: IterationFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Iteration>> {
    await this.projectsService.getProject(actor.workspaceId, projectId);
    const page = await this.iterationRepo.listByProject(
      projectId,
      actor.workspaceId,
      filters,
      args,
    );
    // Enrich each iteration with its task-estimate rollup (IT-001).
    const estimates = await this.iterationRepo.taskEstimatesByIteration(
      actor.workspaceId,
      page.data.map((i) => i.id),
    );
    return {
      ...page,
      data: page.data.map((i) => ({ ...i, taskEstimate: estimates.get(i.id) ?? 0 })),
    };
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
    await this.projectsService.assertProjectWritable(actor.workspaceId, projectId);

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
   * Load an iteration for a read. Project-scoped `timebox:view` is enforced by
   * the PolicyGuard at the route (resource-resolved from :id); this just loads.
   *
   * `timebox:view`, NOT `iteration:view`: §3.2 hides the `Plan > Timeboxes` SURFACE from an Editor
   * while giving it view-and-update on `Track > Iteration Status`, and one code cannot serve both.
   * `iteration:view` stays with the Editor because the iteration LIST feeds Iteration Status, Backlog,
   * Team Status and Quality; only this detail read and its activity tab moved.
   */
  async getIterationForView(actor: JwtPayload, id: string): Promise<Iteration> {
    return this.getIteration(actor.workspaceId, id);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateIteration(
    actor: JwtPayload,
    id: string,
    input: UpdateIterationInput,
  ): Promise<Iteration> {
    const current = await this.getIteration(actor.workspaceId, id);
    await this.projectsService.assertProjectWritable(actor.workspaceId, current.projectId);

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
    await this.projectsService.assertProjectWritable(actor.workspaceId, iteration.projectId);
    if (iteration.state !== 'planning') {
      throw new PreconditionFailedException(
        'ITERATION_NOT_PLANNING',
        'Only iterations in the Planning state can be deleted',
      );
    }
    /**
     * Deleting the row UNSCHEDULES its work; it does not orphan it and it does not cascade.
     *
     * `work_items.iteration_id` and `work.tasks.iteration_id` carry `ON DELETE SET NULL` as of
     * migration 0114, so the items survive and become unscheduled in the same statement as this
     * DELETE. That is Rally's documented behaviour — "If you delete an iteration that stories and
     * defects are scheduled in, they will all be updated to unscheduled" — and it is enforced in the
     * database rather than here because `db/seeds/**` and raw SQL write those tables directly.
     *
     * Before 0114 neither column had a key and this method was exactly the two lines below, so every
     * scheduled item was left pointing at a row that no longer existed. The 2026-08-04 audit called
     * it the highest-value fix it found.
     */
    await this.iterationRepo.delete(id);
    this.logger.log({ iterationId: id }, 'Iteration deleted; its work items are now unscheduled');
  }

  // ── Commit (planning → committed) ───────────────────────────────────────────

  async commitIteration(actor: JwtPayload, id: string): Promise<Iteration> {
    const iteration = await this.getIteration(actor.workspaceId, id);
    // The two state transitions were the only writes in this service that skipped the
    // archived-project rule (PRJ-FR-010), so an archived project's sprint could still be
    // committed — which also starts the hourly Burndown snapshot writing new rows for it
    // (`findActiveIterations` selects on `state = 'committed'`).
    await this.projectsService.assertProjectWritable(actor.workspaceId, iteration.projectId);

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
    // See `commitIteration`: both transitions carry the archived-project rule now. Accept is not
    // an undo of anything — it advances the iteration and stamps `completedAt` — so it is an
    // ordinary content write (PRJ-FR-010).
    await this.projectsService.assertProjectWritable(workspaceId, iteration.projectId);

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
    // An archived project is read-only end to end, and rollover is a write on its work items.
    await this.projectsService.assertProjectWritable(workspaceId, iteration.projectId);

    if (opts.moveToIterationId) {
      const target = await this.getIteration(workspaceId, opts.moveToIterationId);
      if (target.projectId !== iteration.projectId) {
        throw new PreconditionFailedException(
          'ITERATION_PROJECT_MISMATCH',
          'Target iteration must belong to the same project',
        );
      }
    }

    /**
     * SELECT the ids, then move each through `WorkItemsService.updateWorkItem`.
     *
     * This used to be a single `db.update(workItems)`, which is faster and wrong. It wrote the
     * column directly and so skipped every rule the ordinary iteration-assignment path applies —
     * the same rules this repo has fixed one at a time elsewhere:
     *
     *   • `assertIterationAssignable` / `ITERATION_TEAM_MISMATCH`. Nothing keeps
     *     `work_items.team_id` and its iteration's team in step by itself, so a bulk move could
     *     park Team Beta's story inside Team Alpha's sprint — exactly the state the update path
     *     refuses one item at a time.
     *   • Iteration AUTO-ACCEPT. CLAUDE.md: "Iteration auto-accept is a condition over
     *     MEMBERSHIP … Every membership write now re-evaluates BOTH affected iterations (the one
     *     left and the one joined)." Rollover is a membership write on up to two iterations and
     *     re-evaluated neither, so moving the last unfinished story out left the source iteration
     *     Committed while its tile read ACCEPTED 100% — the precise defect
     *     `derived-invariants.e2e.spec.ts` was written to pin.
     *   • ACTIVITY. The items' Revision History showed nothing at all, though their iteration had
     *     changed. A value that moves with no entry is unauditable.
     *   • the Editor team check that used to sit on that path. (Team scope was dropped as an
     *     authorization boundary by ruling on 2026-08-14 — see CLAUDE.md — so this line is history
     *     now, kept because it is part of why this method routes through `updateWorkItem` at all.)
     *
     * Per item rather than in bulk, and that trade is deliberate: an iteration holds tens of
     * stories, not thousands, and correctness on a membership change is worth more than one
     * round trip. `updateWorkItem` opens its own transaction per item, so a mid-way failure leaves
     * the already-moved items moved — reported honestly in `movedCount` rather than rolled back
     * silently.
     */
    const unfinished = await this.db
      .select({ id: workItems.id })
      .from(workItems)
      .where(
        and(
          eq(workItems.iterationId, id),
          eq(workItems.workspaceId, workspaceId),
          inArray(workItems.type, ['story', 'defect']),
          isNull(workItems.deletedAt),
          sql`${workItems.scheduleState} not in (${acceptedScheduleStatesSql()})`,
        ),
      );

    let movedCount = 0;
    for (const row of unfinished) {
      await this.workItemsService.updateWorkItem(actor, row.id, {
        iterationId: opts.moveToIterationId ?? null,
      });
      movedCount += 1;
    }

    this.logger.log(
      {
        iterationId: id,
        moveToIterationId: opts.moveToIterationId ?? null,
        movedCount,
      },
      'Iteration unfinished items rolled over',
    );
    return { movedCount };
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
