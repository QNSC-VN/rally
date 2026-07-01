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
import { ISprintRepository, SPRINT_REPOSITORY } from '../domain/ports/sprint.repository';
import type { Sprint, UpdateSprintInput } from '../domain/sprint.types';

@Injectable()
export class PlanningService {
  private readonly logger = new Logger(PlanningService.name);

  constructor(
    @Inject(SPRINT_REPOSITORY) private readonly sprintRepo: ISprintRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly projectsService: ProjectsService,
  ) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async listSprints(
    actor: JwtPayload,
    projectId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Sprint>> {
    await this.projectsService.getProject(actor.tenantId, projectId);
    return this.sprintRepo.listByProject(projectId, actor.tenantId, args);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createSprint(
    actor: JwtPayload,
    projectId: string,
    name: string,
    opts: { goal?: string; startDate?: string; endDate?: string } = {},
  ): Promise<Sprint> {
    await this.projectsService.getProject(actor.tenantId, projectId);

    const sprint = await this.sprintRepo.create({
      id: uuidv7(),
      tenantId: actor.tenantId,
      projectId,
      name,
      goal: opts.goal,
      startDate: opts.startDate,
      endDate: opts.endDate,
    });

    this.logger.log({ sprintId: sprint.id, projectId, userId: actor.sub }, 'Sprint created');
    return sprint;
  }

  // ── Get ───────────────────────────────────────────────────────────────────

  async getSprint(tenantId: string, id: string): Promise<Sprint> {
    const sprint = await this.sprintRepo.findById(id);
    if (!sprint || sprint.tenantId !== tenantId) {
      throw new NotFoundException('SPRINT_NOT_FOUND', 'Sprint not found');
    }
    return sprint;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateSprint(tenantId: string, id: string, input: UpdateSprintInput): Promise<Sprint> {
    await this.getSprint(tenantId, id);
    return this.sprintRepo.update(id, input);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteSprint(tenantId: string, id: string): Promise<void> {
    const sprint = await this.getSprint(tenantId, id);
    if (sprint.status !== 'planned') {
      throw new PreconditionFailedException(
        'SPRINT_ALREADY_ACTIVE',
        'Only planned sprints can be deleted',
      );
    }
    await this.sprintRepo.delete(id);
    this.logger.log({ sprintId: id }, 'Sprint deleted');
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  async startSprint(tenantId: string, id: string): Promise<Sprint> {
    const sprint = await this.getSprint(tenantId, id);

    if (sprint.status !== 'planned') {
      throw new PreconditionFailedException(
        'SPRINT_ALREADY_ACTIVE',
        'Sprint is not in planned state',
      );
    }

    const active = await this.sprintRepo.findActive(sprint.projectId);
    if (active) {
      throw new ConflictException(
        'SPRINT_ALREADY_ACTIVE',
        'Another sprint is already active for this project',
      );
    }

    const updated = await this.sprintRepo.update(id, { status: 'active' });
    this.logger.log({ sprintId: id }, 'Sprint started');
    return updated;
  }

  // ── Complete ──────────────────────────────────────────────────────────────

  async completeSprint(
    tenantId: string,
    id: string,
    opts: { moveToSprintId?: string } = {},
  ): Promise<Sprint> {
    const sprint = await this.getSprint(tenantId, id);

    if (sprint.status !== 'active') {
      throw new PreconditionFailedException(
        'SPRINT_ALREADY_ACTIVE',
        'Only active sprints can be completed',
      );
    }

    // Validate target sprint exists and belongs to same project
    if (opts.moveToSprintId) {
      const target = await this.getSprint(tenantId, opts.moveToSprintId);
      if (target.projectId !== sprint.projectId) {
        throw new PreconditionFailedException(
          'SPRINT_PROJECT_MISMATCH',
          'Target sprint must belong to the same project',
        );
      }
    }

    // Find 'done' category status IDs for this project
    const doneStatuses = await this.db
      .select({ id: workflowStatuses.id })
      .from(workflowStatuses)
      .where(
        and(
          eq(workflowStatuses.projectId, sprint.projectId),
          eq(workflowStatuses.category, 'done'),
        ),
      );
    const doneStatusIds = doneStatuses.map((s) => s.id);

    // Move unfinished items to target sprint or backlog
    if (doneStatusIds.length > 0) {
      const whereConditions = [
        eq(workItems.iterationId, id),
        eq(workItems.tenantId, tenantId),
        isNull(workItems.deletedAt),
      ];
      // Only move items NOT in done statuses
      if (doneStatusIds.length > 0) {
        whereConditions.push(
          // not in done statuses
          ...(doneStatusIds.length === 1
            ? [ne(workItems.statusId, doneStatusIds[0]!)]
            : [and(...doneStatusIds.map((sid) => ne(workItems.statusId, sid)))!]),
        );
      }

      await this.db
        .update(workItems)
        .set({
          iterationId: opts.moveToSprintId ?? null,
          updatedAt: new Date(),
        })
        .where(and(...whereConditions));
    }

    const updated = await this.sprintRepo.update(id, {
      status: 'completed',
      completedAt: new Date(),
    });
    this.logger.log(
      { sprintId: id, moveToSprintId: opts.moveToSprintId ?? null },
      'Sprint completed',
    );
    return updated;
  }
}
