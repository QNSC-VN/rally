import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  PermissionDeniedException,
  PreconditionFailedException,
  Span,
  UnitOfWork,
  between,
} from '@platform';
import type { JwtPayload, CursorPayload, PagedResult, DbExecutor } from '@platform';
import { ProjectsService } from '@modules/projects';
import { IWorkItemRepository, WORK_ITEM_REPOSITORY } from '../domain/ports/work-item.repository';
import {
  IActivityLogRepository,
  ACTIVITY_LOG_REPOSITORY,
} from '../domain/ports/activity-log.repository';
import { ITimeLogRepository, TIME_LOG_REPOSITORY } from '../domain/ports/time-log.repository';
import { IWatcherRepository, WATCHER_REPOSITORY } from '../domain/ports/watcher.repository';
import {
  IAttachmentRepository,
  ATTACHMENT_REPOSITORY,
} from '../domain/ports/attachment.repository';
import type {
  WorkItem,
  WorkItemType,
  WorkItemPriority,
  WorkItemScheduleState,
  WorkItemFilters,
  UpdateWorkItemInput,
  TaskTotals,
} from '../domain/work-item.types';
import type {
  ActivityLog,
  ActivityAction,
  ActivityChange,
  ActivityEntityType,
  CreateActivityLogInput,
} from '../domain/activity-log.types';
import type { TimeLog } from '../domain/time-log.types';
import type { Watcher } from '../domain/watcher.types';
import type { Attachment } from '../domain/attachment.types';
import { diffWorkItem } from './activity-diff';
import { StorageService } from '@platform';
import {
  ATTACHMENT_ALLOWED_MIME_TYPES,
  ATTACHMENT_MAX_PER_WORK_ITEM,
  ATTACHMENT_MAX_SIZE_BYTES,
} from '../domain/attachment.rules';

interface CreateWorkItemOpts {
  description?: string;
  statusId?: string;
  scheduleState?: WorkItemScheduleState;
  priority?: WorkItemPriority;
  assigneeId?: string;
  reporterId?: string;
  parentId?: string;
  teamId?: string;
  storyPoints?: number;
  estimateHours?: string;
  todoHours?: string;
  actualHours?: string;
  acceptanceCriteria?: string;
  notes?: string;
  releaseNotes?: string;
}

@Injectable()
export class WorkItemsService {
  private readonly logger = new Logger(WorkItemsService.name);

  constructor(
    @Inject(WORK_ITEM_REPOSITORY) private readonly workItemRepo: IWorkItemRepository,
    @Inject(ACTIVITY_LOG_REPOSITORY) private readonly activityRepo: IActivityLogRepository,
    @Inject(TIME_LOG_REPOSITORY) private readonly timeLogRepo: ITimeLogRepository,
    @Inject(WATCHER_REPOSITORY) private readonly watcherRepo: IWatcherRepository,
    @Inject(ATTACHMENT_REPOSITORY) private readonly attachmentRepo: IAttachmentRepository,
    private readonly storageService: StorageService,
    private readonly projectsService: ProjectsService,
    private readonly uow: UnitOfWork,
  ) {}

  // ── Activity helpers ────────────────────────────────────────────────────────

  /**
   * Build a single activity input record (does NOT yet persist).
   * Call appendActivity / appendActivityBatch to actually write.
   */
  private buildActivityInput(
    item: WorkItem,
    entityType: ActivityEntityType,
    actorId: string,
    action: ActivityAction,
    changes: ActivityChange | null,
    metadata: Record<string, unknown> = {},
  ): CreateActivityLogInput {
    return {
      id: uuidv7(),
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      // Anchor task entries to the parent so the item history shows them too.
      workItemId: entityType === 'task' ? (item.parentId ?? item.id) : item.id,
      entityType,
      entityId: item.id,
      actorId,
      action,
      changes,
      metadata,
    };
  }

  /** Single entry — used for created/deleted events where there is only one entry. */
  private async appendActivity(
    tx: DbExecutor,
    item: WorkItem,
    entityType: ActivityEntityType,
    actorId: string,
    action: ActivityAction,
    changes: ActivityChange | null,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.activityRepo.appendMany(
      [this.buildActivityInput(item, entityType, actorId, action, changes, metadata)],
      tx,
    );
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async listWorkItems(
    actor: JwtPayload,
    projectId: string,
    filters: WorkItemFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkItem>> {
    await this.projectsService.getProject(actor.workspaceId, projectId);
    return this.workItemRepo.listByProject(projectId, actor.workspaceId, filters, args);
  }

  /** Backlog list — story + defect only, server-side filter/search/pagination. */
  async listBacklog(
    actor: JwtPayload,
    projectId: string,
    filters: WorkItemFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkItem>> {
    await this.projectsService.getProject(actor.workspaceId, projectId);
    return this.workItemRepo.listBacklog(projectId, actor.workspaceId, filters, args);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  @Span('work-items.create')
  async createWorkItem(
    actor: JwtPayload,
    projectId: string,
    type: WorkItemType,
    title: string,
    opts: CreateWorkItemOpts = {},
  ): Promise<WorkItem> {
    const project = await this.projectsService.getProject(actor.workspaceId, projectId);

    // P1-15: assignee must be an active workspace member
    if (opts.assigneeId) {
      await this.projectsService.assertWorkspaceMember(project.workspaceId, opts.assigneeId);
    }

    // P1-15: parentId must belong to the same project
    if (opts.parentId) {
      const parent = await this.getWorkItem(actor.workspaceId, opts.parentId);
      if (parent.projectId !== projectId) {
        throw new PreconditionFailedException(
          'WORK_ITEM_PARENT_SCOPE_MISMATCH',
          'Parent work item does not belong to the same project',
        );
      }
    }

    const statusId = await this.resolveStatusId(actor.workspaceId, projectId, opts.statusId);
    if (opts.teamId) {
      await this.assertTeamLinked(actor.workspaceId, projectId, opts.teamId);
    }

    // item_key reservation is atomic (advisory-locked counter). A failed insert
    // after this point only leaves a numbering gap, which is acceptable.
    const itemKey = await this.projectsService.generateItemKey(actor.workspaceId, projectId);

    const workItem = await this.uow.run(async (tx) => {
      const created = await this.workItemRepo.create(
        {
          id: uuidv7(),
          workspaceId: actor.workspaceId,
          projectId,
          itemKey,
          type,
          title,
          description: opts.description,
          statusId,
          scheduleState: opts.scheduleState ?? 'defined',
          priority: opts.priority ?? 'none',
          assigneeId: opts.assigneeId,
          reporterId: opts.reporterId ?? actor.sub,
          parentId: opts.parentId,
          teamId: opts.teamId,
          storyPoints: opts.storyPoints,
          estimateHours: opts.estimateHours,
          todoHours: opts.todoHours,
          actualHours: opts.actualHours,
          acceptanceCriteria: opts.acceptanceCriteria,
          notes: opts.notes,
          releaseNotes: opts.releaseNotes,
          rank: '',
          createdBy: actor.sub,
        },
        tx,
      );

      const isTask = type === 'task';
      await this.appendActivity(
        tx,
        created,
        isTask ? 'task' : 'work_item',
        actor.sub,
        isTask ? 'task.created' : 'work_item.created',
        null,
        isTask
          ? { parentId: created.parentId, title }
          : { title, type, projectId, teamId: opts.teamId ?? null },
      );

      return created;
    });

    this.logger.log(
      { workItemId: workItem.id, itemKey, projectId, type, userId: actor.sub },
      'Work item created',
    );

    // Auto-watch: creator is automatically subscribed (non-blocking, best-effort).
    const autoWatchers = [actor.sub];
    if (workItem.assigneeId && workItem.assigneeId !== actor.sub) {
      autoWatchers.push(workItem.assigneeId);
    }
    this.watcherRepo.watchMany(workItem.id, autoWatchers, actor.workspaceId)
      .catch((err: unknown) => {
        this.logger.warn(
          { err, workItemId: workItem.id, watchers: autoWatchers },
          'Auto-watch failed — proceeding without watch',
        );
      });

    return workItem;
  }

  /** Create a child task under a story/defect (Tasks tab). */
  @Span('work-items.create-task')
  async createTask(
    actor: JwtPayload,
    parentId: string,
    title: string,
    opts: Omit<CreateWorkItemOpts, 'parentId'> = {},
  ): Promise<WorkItem> {
    const parent = await this.getWorkItem(actor.workspaceId, parentId);
    if (parent.type === 'task') {
      throw new PreconditionFailedException(
        'WORK_ITEM_INVALID_PARENT_TYPE',
        'A task cannot be created under another task',
      );
    }
    return this.createWorkItem(actor, parent.projectId, 'task', title, {
      ...opts,
      parentId: parent.id,
      assigneeId: opts.assigneeId ?? parent.assigneeId ?? undefined,
    });
  }

  // ── Get ───────────────────────────────────────────────────────────────────

  async getWorkItem(workspaceId: string, id: string): Promise<WorkItem> {
    const item = await this.workItemRepo.findById(id, workspaceId);
    if (!item || item.deletedAt || item.workspaceId !== workspaceId) {
      throw new NotFoundException('WORK_ITEM_NOT_FOUND', 'Work item not found');
    }
    return item;
  }

  // ── Tasks (list + totals) ───────────────────────────────────────────────────

  async listTasks(workspaceId: string, parentId: string): Promise<WorkItem[]> {
    await this.getWorkItem(workspaceId, parentId);
    return this.workItemRepo.listTasksByParent(parentId, workspaceId);
  }

  async getTaskTotals(workspaceId: string, parentId: string): Promise<TaskTotals> {
    await this.getWorkItem(workspaceId, parentId);
    return this.workItemRepo.getTaskTotals(parentId, workspaceId);
  }

  // ── Activity (Revision History) ──────────────────────────────────────────────

  async getActivity(
    workspaceId: string,
    workItemId: string,
    args: { limit: number; offset: number },
  ): Promise<{ items: ActivityLog[]; total: number }> {
    await this.getWorkItem(workspaceId, workItemId);
    return this.activityRepo.listByWorkItem(workItemId, workspaceId, args);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  @Span('work-items.update')
  async updateWorkItem(
    actor: JwtPayload,
    id: string,
    input: UpdateWorkItemInput,
  ): Promise<WorkItem> {
    const item = await this.getWorkItem(actor.workspaceId, id);

    // P1-15: validate new assignee is an active workspace member
    if (input.assigneeId && input.assigneeId !== item.assigneeId) {
      const project = await this.projectsService.getProject(actor.workspaceId, item.projectId);
      await this.projectsService.assertWorkspaceMember(project.workspaceId, input.assigneeId);
    }

    // Validate status transition if statusId is changing
    if (input.statusId && input.statusId !== item.statusId) {
      await this.projectsService.assertTransitionAllowed(
        item.projectId,
        item.statusId,
        input.statusId,
      );
    }

    // P2-BL-02: Story items have no editable priority in the backlog.
    if (input.priority && input.priority !== 'none' && item.type === 'story') {
      throw new PreconditionFailedException(
        'WORK_ITEM_STORY_HAS_NO_PRIORITY',
        'Priority is only editable on defects',
      );
    }

    // P2-BL-02: assignment scope validation — iteration must share the work
    // item's project/team; release must share its project. null unassigns.
    if (input.iterationId) {
      await this.assertIterationAssignable(actor.workspaceId, item, input.iterationId);
    }
    if (input.releaseId) {
      await this.assertReleaseAssignable(actor.workspaceId, item.projectId, input.releaseId);
    }

    const isTask = item.type === 'task';
    const entries = diffWorkItem(item, input, isTask);

    return this.uow.run(async (tx) => {
      const updated = await this.workItemRepo.update(id, { ...input, updatedBy: actor.sub }, actor.workspaceId, tx);

      // Build all diff entries then flush in ONE multi-row INSERT — avoids N
      // sequential round-trips for edits that touch multiple fields at once.
      const entityType = isTask ? ('task' as const) : ('work_item' as const);
      const activityInputs = entries.map((e) =>
        this.buildActivityInput(updated, entityType, actor.sub, e.action, e.change),
      );
      await this.activityRepo.appendMany(activityInputs, tx);

      return updated;
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  @Span('work-items.delete')
  async deleteWorkItem(workspaceId: string, id: string): Promise<void> {
    await this.getWorkItem(workspaceId, id);
    await this.workItemRepo.softDelete(id, workspaceId);
    this.logger.log({ workItemId: id }, 'Work item soft-deleted');
  }

  // ── Move (board transition) ───────────────────────────────────────────────

  @Span('work-items.move')
  async moveWorkItem(actor: JwtPayload, id: string, toStatusId: string): Promise<WorkItem> {
    return this.updateWorkItem(actor, id, { statusId: toStatusId });
  }

  // ── Reorder (backlog drag-and-drop) ───────────────────────────────────────

  async reorderWorkItems(
    workspaceId: string,
    items: Array<{ id: string; rank: string }>,
  ): Promise<void> {
    if (items.length === 0) return;
    // Validate all items belong to this tenant before updating
    const existing = await Promise.all(items.map(({ id }) => this.getWorkItem(workspaceId, id)));
    if (existing.some((w) => w.workspaceId !== workspaceId)) {
      throw new Error('Tenant mismatch');
    }
    // Wrap in UoW so all rank UPDATEs are one atomic transaction with RLS active.
    await this.uow.run((tx) => this.workItemRepo.reorderItems(items, workspaceId, tx));
  }

  // ── Neighbour-based reorder (P2-BL-05) ────────────────────────────────────

  /**
   * Reorder a single backlog item between two neighbours by computing a
   * LexoRank strictly between their ranks — a single-row UPDATE, no full
   * re-numbering. `beforeId`/`afterId` are the items immediately above/below
   * the target's new position (either may be null at a list boundary).
   */
  @Span('work-items.rank')
  async rankWorkItem(
    actor: JwtPayload,
    id: string,
    opts: { projectId: string; beforeId?: string | null; afterId?: string | null },
  ): Promise<WorkItem> {
    const item = await this.getWorkItem(actor.workspaceId, id);
    if (item.projectId !== opts.projectId) {
      throw new PreconditionFailedException(
        'WORK_ITEM_PARENT_SCOPE_MISMATCH',
        'Work item does not belong to the given project',
      );
    }

    // Resolve neighbour ranks; each neighbour must be in the same project/backlog.
    const neighbourIds = [opts.beforeId, opts.afterId].filter(
      (n): n is string => typeof n === 'string',
    );
    const neighbours = await this.workItemRepo.findByIds(neighbourIds, actor.workspaceId);
    const byId = new Map(neighbours.map((w) => [w.id, w]));

    const rankOf = (nid: string | null | undefined): string | null => {
      if (!nid) return null;
      const n = byId.get(nid);
      if (!n || n.projectId !== opts.projectId) {
        throw new PreconditionFailedException(
          'WORK_ITEM_PARENT_SCOPE_MISMATCH',
          'Neighbour item is not in the same project backlog',
        );
      }
      return n.rank;
    };

    const lowRank = rankOf(opts.beforeId);
    const highRank = rankOf(opts.afterId);

    let newRank: string;
    try {
      newRank = between(lowRank, highRank);
    } catch {
      // Neighbours out of order (stale client view) — reject rather than corrupt order.
      throw new PreconditionFailedException(
        'WORK_ITEM_RANK_CONFLICT',
        'Backlog order changed; refresh and retry',
      );
    }

    return this.uow.run((tx) =>
      this.workItemRepo.update(id, { rank: newRank, updatedBy: actor.sub }, actor.workspaceId, tx),
    );
  }

  // ── Bulk assignment (P2-BL-03 / P2-BL-04) ─────────────────────────────────

  /**
   * Assign (or unassign, when releaseId is null) a release to many items in one
   * all-or-nothing transaction. Every item must be in the given tenant/project;
   * the release must belong to that project. Any violation fails the whole call.
   */
  @Span('work-items.bulk-release')
  async bulkAssignRelease(
    actor: JwtPayload,
    projectId: string,
    itemIds: string[],
    releaseId: string | null,
  ): Promise<number> {
    const items = await this.loadBulkItems(actor.workspaceId, projectId, itemIds);
    if (releaseId) {
      await this.assertReleaseAssignable(actor.workspaceId, projectId, releaseId);
    }
    await this.uow.run((tx) =>
      this.workItemRepo.assignRelease(
        items.map((i) => i.id),
        releaseId,
        actor.workspaceId,
        actor.sub,
        tx,
      ),
    );
    this.logger.log({ projectId, count: items.length, releaseId }, 'Bulk release assigned');
    return items.length;
  }

  /**
   * Assign (or unassign, when iterationId is null) an iteration to many items in
   * one all-or-nothing transaction. Every item must be a story/defect in the
   * given tenant/project; the iteration must share that project and, when the
   * iteration is team-scoped, the same team. Any violation fails the whole call.
   */
  @Span('work-items.bulk-iteration')
  async bulkAssignIteration(
    actor: JwtPayload,
    projectId: string,
    itemIds: string[],
    iterationId: string | null,
  ): Promise<number> {
    const items = await this.loadBulkItems(actor.workspaceId, projectId, itemIds);

    // P2.1 scope: only stories and defects can be scheduled into an iteration.
    const nonBacklog = items.find((i) => i.type !== 'story' && i.type !== 'defect');
    if (nonBacklog) {
      throw new PreconditionFailedException(
        'WORK_ITEM_NOT_BACKLOG_TYPE',
        'Only stories and defects can be assigned to an iteration',
      );
    }

    if (iterationId) {
      for (const item of items) {
        await this.assertIterationAssignable(actor.workspaceId, item, iterationId);
      }
    }

    await this.uow.run((tx) =>
      this.workItemRepo.assignIteration(
        items.map((i) => i.id),
        iterationId,
        actor.workspaceId,
        actor.sub,
        tx,
      ),
    );
    this.logger.log({ projectId, count: items.length, iterationId }, 'Bulk iteration assigned');
    return items.length;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Load and validate a set of item ids for a bulk operation: all must exist,
   * be non-deleted, and belong to the given tenant/project. Fails the whole
   * request (all-or-nothing) if any id is missing or out of scope.
   */
  private async loadBulkItems(
    workspaceId: string,
    projectId: string,
    itemIds: string[],
  ): Promise<WorkItem[]> {
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) {
      throw new PreconditionFailedException('WORK_ITEM_EMPTY_SELECTION', 'No items selected');
    }
    const items = await this.workItemRepo.findByIds(ids, workspaceId);
    if (items.length !== ids.length) {
      throw new NotFoundException('WORK_ITEM_NOT_FOUND', 'One or more work items were not found');
    }
    const outOfProject = items.find((i) => i.projectId !== projectId);
    if (outOfProject) {
      throw new PreconditionFailedException(
        'WORK_ITEM_PARENT_SCOPE_MISMATCH',
        'All items must belong to the same project',
      );
    }
    return items;
  }

  /**
   * An iteration is assignable to a work item when it exists in the same tenant,
   * shares the item's project, and — if the iteration is team-scoped — shares
   * the item's team. Team-agnostic iterations (teamId null) accept any team.
   */
  private async assertIterationAssignable(
    workspaceId: string,
    item: WorkItem,
    iterationId: string,
  ): Promise<void> {
    const scope = await this.workItemRepo.findIterationScope(iterationId, workspaceId);
    if (!scope) {
      throw new NotFoundException('ITERATION_NOT_FOUND', 'Iteration not found');
    }
    if (scope.projectId !== item.projectId) {
      throw new PreconditionFailedException(
        'ITERATION_PROJECT_MISMATCH',
        'Iteration must belong to the same project as the work item',
      );
    }
    if (scope.teamId && item.teamId && scope.teamId !== item.teamId) {
      throw new PreconditionFailedException(
        'ITERATION_TEAM_MISMATCH',
        'Iteration must belong to the same team as the work item',
      );
    }
  }

  /** A release is assignable when it exists in the same tenant and project. */
  private async assertReleaseAssignable(
    workspaceId: string,
    projectId: string,
    releaseId: string,
  ): Promise<void> {
    const releaseProjectId = await this.workItemRepo.findReleaseProject(releaseId, workspaceId);
    if (!releaseProjectId) {
      throw new NotFoundException('RELEASE_NOT_FOUND', 'Release not found');
    }
    if (releaseProjectId !== projectId) {
      throw new PreconditionFailedException(
        'RELEASE_PROJECT_MISMATCH',
        'Release must belong to the same project as the work item',
      );
    }
  }

  private async resolveStatusId(
    workspaceId: string,
    projectId: string,
    requested?: string,
  ): Promise<string> {
    const statuses = await this.projectsService.listStatuses(workspaceId, projectId);
    if (requested) {
      const found = statuses.find((s) => s.id === requested);
      if (!found) {
        throw new NotFoundException(
          'WORKFLOW_STATUS_NOT_FOUND',
          'Status not found for this project',
        );
      }
      return requested;
    }
    const defaultStatus = statuses.find((s) => s.isDefault) ?? statuses[0];
    if (!defaultStatus) {
      throw new PreconditionFailedException(
        'WORKFLOW_STATUS_NOT_FOUND',
        'No workflow status configured for this project',
      );
    }
    return defaultStatus.id;
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

  // ── Labels ────────────────────────────────────────────────────────────────

  async getWorkItemLabels(
    workspaceId: string,
    id: string,
  ): Promise<Array<{ id: string; name: string; color: string }>> {
    await this.getWorkItem(workspaceId, id);
    return this.workItemRepo.listLabels(id);
  }

  async addLabelToWorkItem(workspaceId: string, id: string, labelId: string): Promise<void> {
    const item = await this.getWorkItem(workspaceId, id);
    // P1-15: label must belong to the same project as the work item
    await this.projectsService.assertLabelBelongsToProject(item.projectId, labelId);
    await this.workItemRepo.addLabel(id, labelId, workspaceId);
  }

  async removeLabelFromWorkItem(workspaceId: string, id: string, labelId: string): Promise<void> {
    await this.getWorkItem(workspaceId, id);
    await this.workItemRepo.removeLabel(id, labelId, workspaceId);
  }

  // ── Time Logging ──────────────────────────────────────────────────────────

  @Span('work-items.list-time-logs')
  async listTimeLogs(
    workspaceId: string,
    workItemId: string,
    args: { page: number; pageSize: number },
  ): Promise<{ items: TimeLog[]; total: number }> {
    await this.getWorkItem(workspaceId, workItemId);
    return this.timeLogRepo.listByWorkItem(workItemId, workspaceId, {
      limit: args.pageSize,
      offset: (args.page - 1) * args.pageSize,
    });
  }

  @Span('work-items.log-time')
  async logTime(
    actor: JwtPayload,
    workItemId: string,
    input: { loggedDate: string; hours: string; description?: string },
  ): Promise<TimeLog> {
    await this.getWorkItem(actor.workspaceId, workItemId);
    const log = await this.timeLogRepo.create({
      id: uuidv7(),
      workspaceId: actor.workspaceId,
      workItemId,
      userId: actor.sub,
      loggedDate: input.loggedDate,
      hours: input.hours,
      description: input.description,
    });
    // Auto-watch the user who logs time so they receive future notifications.
    this.watcherRepo.watch(workItemId, actor.sub, actor.workspaceId)
      .catch((err: unknown) => {
        this.logger.warn({ err, workItemId }, 'Auto-watch on time-log failed — proceeding');
      });
    this.logger.log({ workItemId, logId: log.id, userId: actor.sub }, 'Time logged');
    return log;
  }

  @Span('work-items.update-time-log')
  async updateTimeLog(
    actor: JwtPayload,
    workItemId: string,
    logId: string,
    input: { loggedDate?: string; hours?: string; description?: string | null },
  ): Promise<TimeLog> {
    await this.getWorkItem(actor.workspaceId, workItemId);
    const log = await this.timeLogRepo.findById(logId, actor.workspaceId);
    if (!log || log.workItemId !== workItemId) {
      throw new NotFoundException('TIME_LOG_NOT_FOUND', 'Time log entry not found');
    }
    // Only the log owner may edit their entry.
    if (log.userId !== actor.sub) {
      throw new PermissionDeniedException(
        'TIME_LOG_NOT_OWNER',
        'Only the log owner may edit this entry',
      );
    }
    return this.timeLogRepo.update(logId, input);
  }

  @Span('work-items.delete-time-log')
  async deleteTimeLog(actor: JwtPayload, workItemId: string, logId: string): Promise<void> {
    await this.getWorkItem(actor.workspaceId, workItemId);
    const log = await this.timeLogRepo.findById(logId, actor.workspaceId);
    if (!log || log.workItemId !== workItemId) {
      throw new NotFoundException('TIME_LOG_NOT_FOUND', 'Time log entry not found');
    }
    // Workspace admins can retract any log; regular users only their own.
    const isAdmin = actor.permissions?.includes('workspace:*');
    if (!isAdmin && log.userId !== actor.sub) {
      throw new PermissionDeniedException(
        'TIME_LOG_NOT_OWNER',
        'Only the log owner or a workspace admin may delete this entry',
      );
    }
    await this.timeLogRepo.softDelete(logId);
    this.logger.log({ workItemId, logId, userId: actor.sub }, 'Time log deleted');
  }

  // ── Watchers ──────────────────────────────────────────────────────────────

  @Span('work-items.list-watchers')
  async listWatchers(workspaceId: string, workItemId: string): Promise<Watcher[]> {
    await this.getWorkItem(workspaceId, workItemId);
    return this.watcherRepo.listByWorkItem(workItemId, workspaceId);
  }

  @Span('work-items.watch')
  async watch(actor: JwtPayload, workItemId: string): Promise<void> {
    await this.getWorkItem(actor.workspaceId, workItemId);
    await this.watcherRepo.watch(workItemId, actor.sub, actor.workspaceId);
  }

  @Span('work-items.unwatch')
  async unwatch(actor: JwtPayload, workItemId: string): Promise<void> {
    await this.getWorkItem(actor.workspaceId, workItemId);
    await this.watcherRepo.unwatch(workItemId, actor.sub);
  }

  // ── Attachments ───────────────────────────────────────────────────────────

  @Span('work-items.presign-attachment')
  async presignAttachment(
    actor: JwtPayload,
    workItemId: string,
    input: { filename: string; mimeType: string; sizeBytes: number },
  ): Promise<{ attachmentId: string; uploadUrl: string }> {
    await this.getWorkItem(actor.workspaceId, workItemId);

    if (!ATTACHMENT_ALLOWED_MIME_TYPES.has(input.mimeType)) {
      throw new PreconditionFailedException(
        'ATTACHMENT_INVALID_TYPE',
        `File type '${input.mimeType}' is not allowed`,
      );
    }

    if (input.sizeBytes > ATTACHMENT_MAX_SIZE_BYTES) {
      throw new PreconditionFailedException(
        'ATTACHMENT_FILE_TOO_LARGE',
        `File exceeds the maximum size of ${ATTACHMENT_MAX_SIZE_BYTES / 1024 / 1024}MB`,
      );
    }

    const current = await this.attachmentRepo.countByWorkItem(workItemId, actor.workspaceId);
    if (current >= ATTACHMENT_MAX_PER_WORK_ITEM) {
      throw new PreconditionFailedException(
        'ATTACHMENT_LIMIT_EXCEEDED',
        `Work item already has the maximum of ${ATTACHMENT_MAX_PER_WORK_ITEM} attachments`,
      );
    }

    const id = uuidv7();
    const ext = input.filename.includes('.') ? `.${input.filename.split('.').pop()}` : '';
    const storageKey = `${actor.workspaceId}/${workItemId}/${id}${ext}`;

    await this.attachmentRepo.create({
      id,
      workspaceId: actor.workspaceId,
      workItemId,
      uploadedBy: actor.sub,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey,
    });

    const { uploadUrl } = await this.storageService.presignPut(storageKey, input.mimeType, input.sizeBytes);
    return { attachmentId: id, uploadUrl };
  }

  @Span('work-items.confirm-attachment')
  async confirmAttachment(
    actor: JwtPayload,
    workItemId: string,
    attachmentId: string,
  ): Promise<Attachment> {
    const item = await this.getWorkItem(actor.workspaceId, workItemId);

    const attachment = await this.attachmentRepo.findById(attachmentId, actor.workspaceId);
    if (!attachment || attachment.workItemId !== workItemId) {
      throw new NotFoundException('ATTACHMENT_NOT_FOUND', 'Attachment not found');
    }

    if (attachment.status !== 'pending') {
      throw new PreconditionFailedException(
        'ATTACHMENT_NOT_PENDING',
        'Attachment is not in pending state',
      );
    }

    // Verify the file was actually uploaded to S3.
    const head = await this.storageService.headObject(attachment.storageKey);
    if (!head) {
      throw new PreconditionFailedException(
        'ATTACHMENT_NOT_PENDING',
        'File not found in storage — please upload first',
      );
    }

    // Tamper check: actual uploaded bytes must match the declared size.
    if (head.contentLength !== attachment.sizeBytes) {
      // Mark as deleted so it can be cleaned up.
      void this.attachmentRepo.softDelete(attachmentId);
      throw new PreconditionFailedException(
        'ATTACHMENT_SIZE_MISMATCH',
        'Uploaded file size does not match declared size',
      );
    }

    const confirmed = await this.attachmentRepo.confirm(attachmentId);
    void this.activityRepo.append({
      id: uuidv7(),
      workspaceId: actor.workspaceId,
      projectId: item.projectId,
      workItemId,
      entityType: 'attachment',
      entityId: attachmentId,
      actorId: actor.sub,
      action: 'attachment.uploaded',
      changes: null,
      metadata: { filename: attachment.filename },
    });
    this.logger.log({ workItemId, attachmentId, filename: attachment.filename }, 'Attachment confirmed');
    return confirmed;
  }

  @Span('work-items.list-attachments')
  async listAttachments(workspaceId: string, workItemId: string): Promise<Attachment[]> {
    await this.getWorkItem(workspaceId, workItemId);
    return this.attachmentRepo.listByWorkItem(workItemId, workspaceId);
  }

  @Span('work-items.get-attachment-download-url')
  async getAttachmentDownloadUrl(
    workspaceId: string,
    workItemId: string,
    attachmentId: string,
  ): Promise<{ downloadUrl: string }> {
    await this.getWorkItem(workspaceId, workItemId);

    const attachment = await this.attachmentRepo.findById(attachmentId, workspaceId);
    if (!attachment || attachment.workItemId !== workItemId || attachment.status !== 'completed') {
      throw new NotFoundException('ATTACHMENT_NOT_FOUND', 'Attachment not found');
    }

    const downloadUrl = await this.storageService.presignGet(attachment.storageKey);
    return { downloadUrl };
  }

  @Span('work-items.delete-attachment')
  async deleteAttachment(actor: JwtPayload, workItemId: string, attachmentId: string): Promise<void> {
    const item = await this.getWorkItem(actor.workspaceId, workItemId);

    const attachment = await this.attachmentRepo.findById(attachmentId, actor.workspaceId);
    if (!attachment || attachment.workItemId !== workItemId) {
      throw new NotFoundException('ATTACHMENT_NOT_FOUND', 'Attachment not found');
    }

    const isAdmin = actor.permissions?.includes('workspace:*');
    if (!isAdmin && attachment.uploadedBy !== actor.sub) {
      throw new PermissionDeniedException(
        'ATTACHMENT_NOT_OWNER',
        'Only the uploader or a workspace admin may delete this attachment',
      );
    }

    await this.attachmentRepo.softDelete(attachmentId);
    // Fire-and-forget: DB row is already soft-deleted; S3 cleanup best-effort.
    void this.storageService.deleteObject(attachment.storageKey);

    void this.activityRepo.append({
      id: uuidv7(),
      workspaceId: actor.workspaceId,
      projectId: item.projectId,
      workItemId,
      entityType: 'attachment',
      entityId: attachmentId,
      actorId: actor.sub,
      action: 'attachment.deleted',
      changes: null,
      metadata: { filename: attachment.filename },
    });
    this.logger.log({ workItemId, attachmentId, filename: attachment.filename }, 'Attachment deleted');
  }
}
