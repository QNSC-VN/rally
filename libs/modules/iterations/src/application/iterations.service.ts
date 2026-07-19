import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { and, eq, isNull, inArray, sql } from 'drizzle-orm';
import {
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  InjectDrizzle,
} from '@platform';
import type { JwtPayload, CursorPayload, PagedResult, DrizzleDB } from '@platform';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { PERMISSION } from '@shared-kernel';
import { workItems } from '../../../../../db/schema/work';
import { acceptedScheduleStatesSql } from '../../../../../db/schema/enums';
import { IIterationRepository, ITERATION_REPOSITORY } from '../domain/ports/iteration.repository';
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
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
  ) {}

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
      await this.assertTeamLinked(actor.workspaceId, projectId, opts.teamId);
    }
    this.assertDateRange(opts.startDate, opts.endDate);

    const keyNumber = await this.iterationRepo.nextKeyNumber(projectId, actor.workspaceId);

    const iteration = await this.iterationRepo.create({
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

    this.logger.log(
      { iterationId: iteration.id, projectId, userId: actor.sub },
      'Iteration created',
    );
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
      await this.assertTeamLinked(actor.workspaceId, current.projectId, input.teamId);
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
      return this.iterationRepo.update(id, fields);
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

    const committed = await this.iterationRepo.findCommitted(iteration.projectId);
    if (committed) {
      throw new ConflictException(
        'ITERATION_ALREADY_COMMITTED',
        'Another iteration is already committed for this project',
      );
    }

    const updated = await this.iterationRepo.update(id, { state: 'committed' });
    this.logger.log({ iterationId: id }, 'Iteration committed');
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

  private async assertTeamLinked(
    workspaceId: string,
    projectId: string,
    teamId: string,
  ): Promise<void> {
    const links = await this.projectsService.listProjectTeams(workspaceId, projectId);
    const linked = links.some((l) => l.teamId === teamId && l.status === 'active');
    if (!linked) {
      throw new PreconditionFailedException(
        'PROJECT_TEAM_LINK_NOT_FOUND',
        'Team is not linked to this project',
      );
    }
  }
}
