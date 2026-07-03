import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { and, eq, isNull, ne } from 'drizzle-orm';
import {
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  InjectDrizzle,
} from '@platform';
import type { JwtPayload, CursorPayload, PagedResult, DrizzleDB } from '@platform';
import { ProjectsService } from '@modules/projects';
import { workItems, workflowStatuses } from '../../../../../db/schema/work';
import {
  IIterationRepository,
  ITERATION_REPOSITORY,
} from '../domain/ports/iteration.repository';
import type {
  Iteration,
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
  ) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async listIterations(
    actor: JwtPayload,
    projectId: string,
    filters: IterationFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Iteration>> {
    await this.projectsService.getProject(actor.tenantId, projectId);
    return this.iterationRepo.listByProject(projectId, actor.tenantId, filters, args);
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
      startDate?: string;
      endDate?: string;
      plannedVelocity?: number;
    } = {},
  ): Promise<Iteration> {
    await this.projectsService.getProject(actor.tenantId, projectId);

    if (opts.teamId) {
      await this.assertTeamLinked(actor.tenantId, projectId, opts.teamId);
    }
    this.assertDateRange(opts.startDate, opts.endDate);

    const keyNumber = await this.iterationRepo.nextKeyNumber(projectId, actor.tenantId);

    const iteration = await this.iterationRepo.create({
      id: uuidv7(),
      tenantId: actor.tenantId,
      projectId,
      teamId: opts.teamId ?? null,
      iterationKey: `IT-${keyNumber}`,
      name,
      goal: opts.goal,
      theme: opts.theme,
      notes: opts.notes,
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

  // ── Get ───────────────────────────────────────────────────────────────────

  async getIteration(tenantId: string, id: string): Promise<Iteration> {
    const iteration = await this.iterationRepo.findById(id);
    if (!iteration || iteration.tenantId !== tenantId) {
      throw new NotFoundException('ITERATION_NOT_FOUND', 'Iteration not found');
    }
    return iteration;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateIteration(
    tenantId: string,
    id: string,
    input: UpdateIterationInput,
  ): Promise<Iteration> {
    const current = await this.getIteration(tenantId, id);

    // Team must remain linked to the iteration's project.
    if (input.teamId) {
      await this.assertTeamLinked(tenantId, current.projectId, input.teamId);
    }

    // Validate the resulting date range (fall back to current values).
    const startDate = input.startDate !== undefined ? input.startDate : current.startDate;
    const endDate = input.endDate !== undefined ? input.endDate : current.endDate;
    this.assertDateRange(startDate ?? undefined, endDate ?? undefined);

    return this.iterationRepo.update(id, input);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteIteration(tenantId: string, id: string): Promise<void> {
    const iteration = await this.getIteration(tenantId, id);
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

  async commitIteration(tenantId: string, id: string): Promise<Iteration> {
    const iteration = await this.getIteration(tenantId, id);

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

  // ── Accept (committed → accepted) — moves unfinished items out ──────────────

  async acceptIteration(
    tenantId: string,
    id: string,
    opts: { moveToIterationId?: string } = {},
  ): Promise<Iteration> {
    const iteration = await this.getIteration(tenantId, id);

    if (iteration.state !== 'committed') {
      throw new PreconditionFailedException(
        'ITERATION_NOT_COMMITTED',
        'Only a committed iteration can be accepted',
      );
    }

    // Validate the carry-over target belongs to the same project.
    if (opts.moveToIterationId) {
      const target = await this.getIteration(tenantId, opts.moveToIterationId);
      if (target.projectId !== iteration.projectId) {
        throw new PreconditionFailedException(
          'ITERATION_PROJECT_MISMATCH',
          'Target iteration must belong to the same project',
        );
      }
    }

    // Find 'done'-category statuses for this project.
    const doneStatuses = await this.db
      .select({ id: workflowStatuses.id })
      .from(workflowStatuses)
      .where(
        and(
          eq(workflowStatuses.projectId, iteration.projectId),
          eq(workflowStatuses.category, 'done'),
        ),
      );
    const doneStatusIds = doneStatuses.map((s) => s.id);

    // Move unfinished (non-done) items to the target iteration or back to backlog.
    if (doneStatusIds.length > 0) {
      const whereConditions = [
        eq(workItems.iterationId, id),
        eq(workItems.tenantId, tenantId),
        isNull(workItems.deletedAt),
        ...(doneStatusIds.length === 1
          ? [ne(workItems.statusId, doneStatusIds[0]!)]
          : [and(...doneStatusIds.map((sid) => ne(workItems.statusId, sid)))!]),
      ];

      await this.db
        .update(workItems)
        .set({
          iterationId: opts.moveToIterationId ?? null,
          updatedAt: new Date(),
        })
        .where(and(...whereConditions));
    }

    const updated = await this.iterationRepo.update(id, {
      state: 'accepted',
      completedAt: new Date(),
    });
    this.logger.log(
      { iterationId: id, moveToIterationId: opts.moveToIterationId ?? null },
      'Iteration accepted',
    );
    return updated;
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
    tenantId: string,
    projectId: string,
    teamId: string,
  ): Promise<void> {
    const links = await this.projectsService.listProjectTeams(tenantId, projectId);
    const linked = links.some((l) => l.teamId === teamId && l.status === 'active');
    if (!linked) {
      throw new PreconditionFailedException(
        'PROJECT_TEAM_LINK_NOT_FOUND',
        'Team is not linked to this project',
      );
    }
  }
}
