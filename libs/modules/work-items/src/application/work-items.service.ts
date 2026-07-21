import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { uuidv7 } from 'uuidv7';

/**
 * Deterministic UUID (v5-style, SHA-1) from an arbitrary business-event key.
 * Used for notification idempotency: the same event → same UUID → the relay's
 * source_event_id unique index de-dupes, while satisfying the UUID column type.
 */
function stableEventId(name: string): string {
  const b = createHash('sha1').update(name).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC-4122 variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
import {
  NotFoundException,
  PermissionDeniedException,
  PreconditionFailedException,
  Span,
  UnitOfWork,
  between,
} from '@platform';
import type { JwtPayload, CursorPayload, PagedResult, DbExecutor } from '@platform';
import { PERMISSION, permissionGrants, type ProjectPermission } from '@shared-kernel';
import {
  isAcceptedScheduleState,
  isCompletedScheduleState,
  type DefectState,
} from '../../../../../db/schema/enums';
import { NotificationSchedulerService } from '@platform/notifications/notification-scheduler.service';
import type {
  NotificationTemplateName,
  NotificationTemplateVars,
} from '@platform/notifications/notification.templates';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { deriveTaskEstimateHours } from '../domain/task-time.rules';
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
import {
  IWorkItemRelationRepository,
  WORK_ITEM_RELATION_REPOSITORY,
} from '../domain/ports/work-item-relation.repository';
import {
  isAcyclicRelationType,
  type WorkItemRelationView,
} from '../domain/work-item-relation.types';
import type { WorkItemRelationType } from '../../../../../db/schema/enums';
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
import type { WorkItemAttachment } from '../domain/attachment.types';
import { diffWorkItem } from './activity-diff';
import { AttachmentsService, WORK_ITEM_ATTACHMENT_POLICY } from '@modules/attachments';

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

interface CreateWorkItemOpts {
  description?: string;
  statusId?: string;
  scheduleState?: WorkItemScheduleState;
  priority?: WorkItemPriority;
  assigneeId?: string;
  reporterId?: string;
  parentId?: string;
  teamId?: string;
  iterationId?: string;
  releaseId?: string;
  storyPoints?: string;
  estimateHours?: string;
  todoHours?: string;
  actualHours?: string;
  acceptanceCriteria?: string;
  notes?: string;
  releaseNotes?: string;
  // P3.4 — Defect-specific fields
  severity?: string | null;
  foundInEnvironment?: string | null;
  foundInReleaseId?: string | null;
  rootCause?: string | null;
  resolution?: string | null;
  devOwnerId?: string | null;
  defectState?: string | null;
  fixedInBuild?: string | null;
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
    @Inject(WORK_ITEM_RELATION_REPOSITORY)
    private readonly relationRepo: IWorkItemRelationRepository,
    private readonly notificationScheduler: NotificationSchedulerService,
    private readonly attachments: AttachmentsService,
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
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
    await this.projectsService.getProject(actor.workspaceId, projectId);
    await this.accessService.assertProjectPermission(actor, projectId, PERMISSION.WORK_ITEM_CREATE);

    // P1-15: parentId must belong to the same project
    if (opts.parentId) {
      const parent = await this.getWorkItem(actor.workspaceId, opts.parentId);
      if (parent.projectId !== projectId) {
        throw new PreconditionFailedException(
          'WORK_ITEM_PARENT_SCOPE_MISMATCH',
          'Parent work item does not belong to the same project',
        );
      }
      // Defects can only have story parents
      if (type === 'defect' && parent.type !== 'story') {
        throw new PreconditionFailedException(
          'WORK_ITEM_INVALID_PARENT_TYPE',
          'A defect can only be created under a user story',
        );
      }
      // Non-defect, non-task items cannot have a parent (only tasks and defects)
      if (type !== 'defect' && type !== 'task') {
        throw new PreconditionFailedException(
          'WORK_ITEM_INVALID_PARENT_TYPE',
          'Only defects and tasks can have a parent work item',
        );
      }
    }

    const statusId = await this.resolveStatusId(actor.workspaceId, projectId, opts.statusId);

    // Every scoped reference (team, iteration, release, foundInRelease and the
    // assignee/reporter/dev-owner person refs) is validated through the ONE
    // assignment-scope guard — the same funnel the update and bulk paths use —
    // so a create can't seed an item with a team/iteration/release that belongs
    // to a different project or (for team-scoped iterations) a different team,
    // nor a person from another workspace. Reachable e.g. via the task create
    // flow, which accepts an explicit iteration and inherits the parent's
    // iteration/team. reporterId defaults to the actor (always a member) so only
    // an explicitly-provided reporter is validated.
    await this.assertAssignmentScope(actor.workspaceId, {
      projectId,
      teamId: opts.teamId ?? null,
      iterationId: opts.iterationId ?? null,
      releaseId: opts.releaseId ?? null,
      foundInReleaseId: opts.foundInReleaseId ?? null,
      memberIds: [opts.assigneeId, opts.reporterId, opts.devOwnerId],
    });

    // New items append to the end of their scope's order (top-level backlog,
    // or the parent's task list). A degenerate '' rank would sort correctly
    // once but corrupt subsequent between() math on drag-reorder.
    const maxRank = await this.workItemRepo.findMaxRank(
      { projectId, parentId: opts.parentId ?? null },
      actor.workspaceId,
    );
    const rank = between(maxRank, null);

    // item_key reservation is atomic (advisory-locked counter). A failed insert
    // after this point only leaves a numbering gap, which is acceptable.
    // If the counter is out of sync with existing data (e.g. seeded records),
    // retry once with a fresh key.
    const MAX_KEY_RETRIES = 2;
    let workItem: WorkItem | undefined;
    let lastErr: unknown;

    for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt++) {
      const itemKey = await this.projectsService.generateItemKey(
        actor.workspaceId,
        projectId,
        type,
      );

      try {
        workItem = await this.uow.run(async (tx) => {
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
              iterationId: opts.iterationId,
              releaseId: opts.releaseId,
              storyPoints: opts.storyPoints,
              // Task Estimate is read-only derived (Estimate = To Do + Actuals);
              // any client-supplied estimate for a task is ignored.
              estimateHours:
                type === 'task'
                  ? deriveTaskEstimateHours(opts.todoHours, opts.actualHours)
                  : opts.estimateHours,
              todoHours: opts.todoHours,
              actualHours: opts.actualHours,
              acceptanceCriteria: opts.acceptanceCriteria,
              notes: opts.notes,
              releaseNotes: opts.releaseNotes,
              rank,
              createdBy: actor.sub,
              // P3.4 — Defect-specific fields
              severity: opts.severity,
              foundInEnvironment: opts.foundInEnvironment,
              foundInReleaseId: opts.foundInReleaseId,
              rootCause: opts.rootCause,
              resolution: opts.resolution,
              devOwnerId: opts.devOwnerId,
              defectState: opts.defectState,
              fixedInBuild: opts.fixedInBuild,
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
        break; // success — exit retry loop
      } catch (err: unknown) {
        lastErr = err;
        if (isDuplicateKeyError(err) && attempt < MAX_KEY_RETRIES - 1) {
          this.logger.warn(
            { itemKey, projectId, attempt: attempt + 1 },
            'Duplicate item key on create — retrying with next key',
          );
          continue;
        }
        throw err; // not a duplicate-key error or last attempt — re-throw
      }
    }

    if (!workItem) throw lastErr;

    this.logger.log(
      { workItemId: workItem.id, itemKey: workItem.itemKey, projectId, type, userId: actor.sub },
      'Work item created',
    );

    // Auto-watch: creator is automatically subscribed (non-blocking, best-effort).
    const autoWatchers = [actor.sub];
    if (workItem.assigneeId && workItem.assigneeId !== actor.sub) {
      autoWatchers.push(workItem.assigneeId);
    }
    this.watcherRepo
      .watchMany(workItem.id, autoWatchers, actor.workspaceId)
      .catch((err: unknown) => {
        this.logger.warn(
          { err, workItemId: workItem.id, watchers: autoWatchers },
          'Auto-watch failed — proceeding without watch',
        );
      });

    return workItem;
  }

  // ── Create task (now writes to tasks table) ────────────────────────

  /**
   * Create a child task under a story/defect (Tasks tab).
   * P3 refactor: tasks now go to the dedicated `tasks` table.
   */
  @Span('work-items.create-task')
  async createTask(
    actor: JwtPayload,
    parentId: string,
    title: string,
    opts: {
      description?: string;
      state?: string;
      assigneeId?: string;
      teamId?: string;
      iterationId?: string;
      estimateHours?: string;
      todoHours?: string;
      actualHours?: string;
    } = {},
  ): Promise<WorkItem> {
    const parent = await this.getWorkItem(actor.workspaceId, parentId);
    if (parent.type === 'task') {
      throw new PreconditionFailedException(
        'WORK_ITEM_INVALID_PARENT_TYPE',
        'A task cannot be created under another task',
      );
    }

    // Delegate to the work-item create flow — the task is created in the
    // dedicated tasks table by the repository layer when type='task'.
    // For now, we still write through the work_items table for backward
    // compatibility, but the service interface accepts the new shape.
    return this.createWorkItem(actor, parent.projectId, 'task', title, {
      ...opts,
      parentId: parent.id,
      iterationId: opts.iterationId ?? parent.iterationId ?? undefined,
      assigneeId: opts.assigneeId ?? parent.assigneeId ?? undefined,
      // SRS P1-04 (Task Management): team defaults to the parent's team unless
      // explicitly provided, keeping the task's project/team compatible with
      // its parent. createWorkItem still validates a provided team is linked.
      teamId: opts.teamId ?? parent.teamId ?? undefined,
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

  /**
   * Load a work item for a MUTATION and authorize the actor against the item's
   * OWN project. This is the single seam that makes every write project-scoped:
   * a workspace-wide grant fast-paths inside assertProjectPermission, while a
   * user who only holds the permission on a different project is rejected. Use
   * this instead of getWorkItem() in every method that changes an item.
   */
  private async getWorkItemForWrite(
    actor: JwtPayload,
    id: string,
    required: ProjectPermission,
  ): Promise<WorkItem> {
    const item = await this.getWorkItem(actor.workspaceId, id);
    await this.accessService.assertProjectPermission(actor, item.projectId, required);
    return item;
  }

  /**
   * Load a work item for a READ and authorize the actor against the item's OWN
   * project via `work_item:view`. The read counterpart of getWorkItemForWrite:
   * a workspace-wide grant fast-paths inside assertProjectPermission, while a
   * user who lacks view on the item's project is rejected — closing the
   * project-isolation gap on sub-resource reads (tasks, activity, labels,
   * time logs, watchers, attachments). Use this instead of getWorkItem() in
   * every actor-facing read that exposes a single item or its sub-resources.
   */
  async getWorkItemForView(actor: JwtPayload, id: string): Promise<WorkItem> {
    const item = await this.getWorkItem(actor.workspaceId, id);
    await this.accessService.assertProjectPermission(
      actor,
      item.projectId,
      PERMISSION.WORK_ITEM_VIEW,
    );
    return item;
  }

  /**
   * Resolve a work item by its human item key within a project. Enables the
   * `/item/:itemKey` detail route to open any type — including tasks, whose rows
   * live in `work.tasks` since the Phase 3 split and are therefore invisible to
   * the work_items search used previously.
   */
  async getWorkItemByKey(actor: JwtPayload, projectId: string, itemKey: string): Promise<WorkItem> {
    const item = await this.workItemRepo.findByKey(itemKey, projectId, actor.workspaceId);
    if (!item) {
      throw new NotFoundException('WORK_ITEM_NOT_FOUND', `Work item ${itemKey} not found`);
    }
    await this.accessService.assertProjectPermission(
      actor,
      item.projectId,
      PERMISSION.WORK_ITEM_VIEW,
    );
    return item;
  }

  // ── Tasks (list + totals) ───────────────────────────────────────────────────

  async listTasks(actor: JwtPayload, parentId: string): Promise<WorkItem[]> {
    await this.getWorkItemForView(actor, parentId);
    return this.workItemRepo.listTasksByParent(parentId, actor.workspaceId);
  }

  async getTaskTotals(actor: JwtPayload, parentId: string): Promise<TaskTotals> {
    await this.getWorkItemForView(actor, parentId);
    return this.workItemRepo.getTaskTotals(parentId, actor.workspaceId);
  }

  // ── Activity (Revision History) ──────────────────────────────────────────────

  async getActivity(
    actor: JwtPayload,
    workItemId: string,
    args: { limit: number; offset: number },
  ): Promise<{ items: ActivityLog[]; total: number }> {
    await this.getWorkItemForView(actor, workItemId);
    return this.activityRepo.listByWorkItem(workItemId, actor.workspaceId, args);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  @Span('work-items.update')
  async updateWorkItem(
    actor: JwtPayload,
    id: string,
    input: UpdateWorkItemInput,
  ): Promise<WorkItem> {
    const item = await this.getWorkItemForWrite(actor, id, PERMISSION.WORK_ITEM_EDIT);

    // TASK-FR-012: a task's Work Product (parent) can be reassigned, but the new
    // parent must be a valid work product (US/DE, never a task) in the SAME
    // project — the same scope rules enforced at task creation. A task always
    // belongs to a Work Product, so clearing the parent is rejected.
    if (item.type === 'task' && input.parentId !== undefined && input.parentId !== item.parentId) {
      if (input.parentId === null) {
        throw new PreconditionFailedException(
          'WORK_ITEM_INVALID_PARENT_TYPE',
          'A task must belong to a work product',
        );
      }
      const newParent = await this.getWorkItem(actor.workspaceId, input.parentId);
      if (newParent.projectId !== item.projectId) {
        throw new PreconditionFailedException(
          'WORK_ITEM_PARENT_SCOPE_MISMATCH',
          'Work product does not belong to the same project',
        );
      }
      if (newParent.type === 'task') {
        throw new PreconditionFailedException(
          'WORK_ITEM_INVALID_PARENT_TYPE',
          'A task cannot be moved under another task',
        );
      }
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

    // Work Item Project and Team must be a valid pair (SRS P1-MANAGE-ORG). All
    // scoped references funnel through the ONE assignment-scope guard, using the
    // team the item WILL have after this patch (input.teamId when changing, else
    // the current team) so a simultaneous team+iteration change is validated
    // against the new team. A null teamId clears the team; the team-link re-check
    // only runs when a team is actually being (re)assigned. Person refs
    // (assignee/reporter/dev-owner) and a defect's foundInRelease are validated
    // here too — only the ones actually changing, so unchanged members aren't
    // re-queried.
    const effectiveTeamId = input.teamId !== undefined ? input.teamId : item.teamId;
    const changedMemberIds: Array<string | null | undefined> = [];
    if (input.assigneeId && input.assigneeId !== item.assigneeId) {
      changedMemberIds.push(input.assigneeId);
    }
    if (input.reporterId && input.reporterId !== item.reporterId) {
      changedMemberIds.push(input.reporterId);
    }
    if (input.devOwnerId && input.devOwnerId !== item.devOwnerId) {
      changedMemberIds.push(input.devOwnerId);
    }
    await this.assertAssignmentScope(
      actor.workspaceId,
      {
        projectId: item.projectId,
        teamId: effectiveTeamId,
        iterationId: input.iterationId ?? null,
        releaseId: input.releaseId ?? null,
        foundInReleaseId: input.foundInReleaseId ?? null,
        memberIds: changedMemberIds,
      },
      { validateTeamLink: Boolean(input.teamId) },
    );

    // P3.4 — Validate defect state transitions.
    // SRS §6 (Quality/Defect) confirmed lifecycle:
    //   Submitted → Open → Fixed → Closed, and Submitted/Open → Closed Declined.
    // FR-017: reopen from Closed / Closed Declined is DEFERRED and must be
    // rejected in Phase 3.4 until BA confirms permission + reason + audit rules.
    if (input.defectState !== undefined && input.defectState !== null && item.defectState) {
      const validTransitions: Record<DefectState, DefectState[]> = {
        submitted: ['open', 'closed_declined'],
        open: ['fixed', 'closed_declined'],
        fixed: ['closed'],
        closed: [],
        closed_declined: [],
      };
      const allowed = validTransitions[item.defectState as DefectState] ?? [];
      if (!allowed.includes(input.defectState as DefectState)) {
        throw new PreconditionFailedException(
          'WORK_ITEM_INVALID_TRANSITION',
          `Invalid defect state transition: ${item.defectState} → ${input.defectState}. Allowed: ${allowed.join(', ') || 'none'}`,
        );
      }
    }

    // ── BR-WI-01: Schedule State and Flow State mirror ──
    // Accept a change to EITHER field and apply it to BOTH, so every downstream
    // rule (roll-up, auto-accept, activity log) sees one coherent state. A
    // request that sets the two to conflicting values is rejected.
    if (
      input.scheduleState !== undefined &&
      input.flowState !== undefined &&
      input.scheduleState !== input.flowState
    ) {
      throw new PreconditionFailedException(
        'WORK_ITEM_STATE_MIRROR_CONFLICT',
        'Schedule State and Flow State must match',
      );
    }
    const nextState = input.scheduleState ?? input.flowState;
    if (nextState !== undefined) {
      input.scheduleState = nextState;
      input.flowState = nextState;
    }

    const isTask = item.type === 'task';
    const taskTransitioningToComplete =
      isTask && input.scheduleState === 'completed' && item.scheduleState !== 'completed';
    // Reverse roll-up (BR-TASK-02): a task leaving Completed reopens its parent.
    const taskTransitioningFromComplete =
      isTask &&
      item.scheduleState === 'completed' &&
      input.scheduleState !== undefined &&
      !isCompletedScheduleState(input.scheduleState);

    // Task Estimate is read-only derived (Estimate = To Do + Actuals). Recompute
    // it from the effective To Do / Actual (incoming patch merged with the stored
    // value) so it stays consistent everywhere and any client-supplied estimate
    // is ignored. To Do is NOT auto-zeroed on completion (BA-confirmed DEV-015).
    if (isTask) {
      const effectiveTodo = input.todoHours !== undefined ? input.todoHours : item.todoHours;
      const effectiveActual =
        input.actualHours !== undefined ? input.actualHours : item.actualHours;
      input.estimateHours = deriveTaskEstimateHours(effectiveTodo, effectiveActual);
    }

    const entries = diffWorkItem(item, input, isTask);

    const updated = await this.uow.run(async (tx) => {
      const updatedInTx = await this.workItemRepo.update(
        id,
        { ...input, updatedBy: actor.sub },
        actor.workspaceId,
        tx,
      );
      const updated = updatedInTx;

      // Build all diff entries then flush in ONE multi-row INSERT — avoids N
      // sequential round-trips for edits that touch multiple fields at once.
      const entityType = isTask ? ('task' as const) : ('work_item' as const);
      const activityInputs = entries.map((e) =>
        this.buildActivityInput(updated, entityType, actor.sub, e.action, e.change),
      );
      await this.activityRepo.appendMany(activityInputs, tx);

      // ── Auto-accept iteration when ALL assigned Story/Defect are accepted (BA F1) ──
      // Fires when this Story/Defect transitions INTO an accepted state and is
      // assigned to an iteration. The repo guards idempotency (committed → accepted
      // only) and the ≥1-item / all-accepted rule.
      if (
        !isTask &&
        input.scheduleState !== undefined &&
        isAcceptedScheduleState(input.scheduleState) &&
        !isAcceptedScheduleState(item.scheduleState) &&
        updated.iterationId
      ) {
        const flipped = await this.workItemRepo.autoAcceptIterationIfComplete(
          updated.iterationId,
          actor.workspaceId,
          tx,
        );
        if (flipped) {
          this.logger.log(
            { iterationId: updated.iterationId },
            'Iteration auto-accepted — all assigned Story/Defect items are accepted',
          );
        }
      }

      // ── Auto-complete parent US/DE when ALL tasks are completed ──
      // NOTE: We use input.scheduleState (not updated.scheduleState) because the
      // repo's update() re-fetches via this.db (pool), not the transaction tx,
      // so updated.scheduleState may still reflect the old state.
      if (taskTransitioningToComplete && item.parentId) {
        const allDone = await this.workItemRepo.areAllTasksComplete(
          item.parentId,
          actor.workspaceId,
          tx,
        );
        if (allDone) {
          // Capture parent's old state before updating (use tx for consistency)
          const parentBefore = await this.workItemRepo.findById(
            item.parentId,
            actor.workspaceId,
            tx,
          );
          // Only advance a parent that is still open — never DOWNGRADE a parent
          // already at a more mature terminal (accepted/release) back to completed.
          if (parentBefore && !isCompletedScheduleState(parentBefore.scheduleState)) {
            await this.workItemRepo.update(
              item.parentId,
              { scheduleState: 'completed', updatedBy: actor.sub },
              actor.workspaceId,
              tx,
            );
            // Log the automatic parent state change
            const freshParent = await this.workItemRepo.findById(
              item.parentId,
              actor.workspaceId,
              tx,
            );
            if (freshParent) {
              await this.activityRepo.appendMany(
                [
                  this.buildActivityInput(
                    freshParent,
                    'work_item',
                    actor.sub,
                    'work_item.schedule_state_changed',
                    { field: 'scheduleState', old: parentBefore.scheduleState, new: 'completed' },
                    { auto: true },
                  ),
                ],
                tx,
              );
            }
          }
        }
      }

      // ── Reverse roll-up (BR-TASK-02 / DEV-018): reopening a child task moves
      // its parent back to In-Progress — but only from 'completed'. A parent the
      // team has manually advanced to a more mature terminal (accepted/release)
      // is never auto-reverted (BA F3 guard). The repo mirrors Flow State too.
      if (taskTransitioningFromComplete && item.parentId) {
        const parentBefore = await this.workItemRepo.findById(item.parentId, actor.workspaceId, tx);
        if (parentBefore && parentBefore.scheduleState === 'completed') {
          await this.workItemRepo.update(
            item.parentId,
            { scheduleState: 'in_progress', updatedBy: actor.sub },
            actor.workspaceId,
            tx,
          );
          const freshParent = await this.workItemRepo.findById(
            item.parentId,
            actor.workspaceId,
            tx,
          );
          if (freshParent) {
            await this.activityRepo.appendMany(
              [
                this.buildActivityInput(
                  freshParent,
                  'work_item',
                  actor.sub,
                  'work_item.schedule_state_changed',
                  { field: 'scheduleState', old: 'completed', new: 'in_progress' },
                  { auto: true },
                ),
              ],
              tx,
            );
          }
        }
      }

      // ── F7 notifications ──
      // Enqueued on the same `tx` as the business write, so the outbox row
      // commits/rolls back atomically with it — no ghost notification, no
      // silent drop on a post-commit crash. Recipient resolution (watchers +
      // permission checks) reads already-committed data off the pool; only
      // the outbox insert itself needs the transaction.

      // Assignment: notify (and auto-watch) the new assignee.
      const assigneeChanged =
        input.assigneeId !== undefined &&
        !!updated.assigneeId &&
        updated.assigneeId !== item.assigneeId;
      if (assigneeChanged && updated.assigneeId) {
        await this.watcherRepo
          .watch(updated.id, updated.assigneeId, actor.workspaceId)
          .catch(() => undefined);
        if (updated.assigneeId !== actor.sub) {
          await this.emitWorkItemNotification(
            'WORK_ITEM_ASSIGNED',
            updated,
            actor.sub,
            [updated.assigneeId],
            { itemKey: updated.itemKey, itemTitle: updated.title, projectId: updated.projectId },
            updated.assigneeId,
            tx,
          );
        }
      }

      // Schedule-state change: notify watchers ∪ assignee (minus the actor).
      if (input.scheduleState !== undefined && updated.scheduleState !== item.scheduleState) {
        const recipients = await this.resolveRecipients(updated, [updated.assigneeId], actor.sub);
        if (recipients.length > 0) {
          await this.emitWorkItemNotification(
            'WORK_ITEM_STATE_CHANGED',
            updated,
            actor.sub,
            recipients,
            {
              itemKey: updated.itemKey,
              itemTitle: updated.title,
              newState: updated.scheduleState,
              projectId: updated.projectId,
            },
            updated.scheduleState,
            tx,
          );
        }
      }

      return updated;
    });

    return updated;
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  @Span('work-items.delete')
  async deleteWorkItem(actor: JwtPayload, id: string): Promise<void> {
    const item = await this.getWorkItemForWrite(actor, id, PERMISSION.WORK_ITEM_DELETE);
    // BA rule (P3.4): defects are never deleted — they are resolved by moving to
    // the 'closed' / 'closed_declined' defect state so the audit trail survives.
    if (item.type === 'defect') {
      throw new PreconditionFailedException(
        'DEFECT_DELETE_FORBIDDEN',
        'Defects cannot be deleted. Resolve the defect by setting its state to Closed or Closed Declined.',
      );
    }
    await this.workItemRepo.softDelete(id, actor.workspaceId);
    this.logger.log({ workItemId: id }, 'Work item soft-deleted');
  }

  // ── Notifications (F7) ──────────────────────────────────────────────────────
  // Producers enqueue in-app notifications for the item's watchers + assignee
  // (minus the actor). The Worker relay applies each recipient's preference and
  // handles delivery/SSE — this layer only fans out candidates.

  /** Watchers ∪ extra recipients, de-duplicated, actor removed, access-gated. */
  private async resolveRecipients(
    item: WorkItem,
    extra: (string | null | undefined)[],
    actorId: string,
  ): Promise<string[]> {
    const watchers = await this.watcherRepo.listUserIds(item.id);
    const set = new Set<string>(watchers);
    for (const id of extra) if (id) set.add(id);
    set.delete(actorId);
    return this.filterByProjectAccess(item.workspaceId, item.projectId, [...set]);
  }

  /**
   * FR-019 — restrict notification recipients to users allowed to access the
   * item's project. Effective per-project permissions are resolved from role
   * assignments (a workspace-scoped role grants access without a membership
   * row), so this is NOT a project_members lookup. Users lacking
   * `work_item:view` on the project are dropped.
   */
  private async filterByProjectAccess(
    workspaceId: string,
    projectId: string,
    userIds: string[],
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    const results = await Promise.all(
      userIds.map(async (userId) => {
        const perms = await this.accessService.getProjectPermissions(
          userId,
          workspaceId,
          projectId,
        );
        return permissionGrants(perms, PERMISSION.WORK_ITEM_VIEW) ? userId : null;
      }),
    );
    return results.filter((id): id is string => id !== null);
  }

  /**
   * Pass `tx` when called from inside an open business transaction (e.g. the
   * update path) so the outbox insert commits/rolls back atomically with the
   * business write — no ghost notification, no silent drop on a post-commit
   * crash. Callers outside a transaction (e.g. comment notifications) may
   * omit it; the scheduler falls back to its own best-effort transaction.
   */
  private async emitWorkItemNotification<K extends NotificationTemplateName>(
    template: K,
    item: WorkItem,
    actorId: string,
    recipientIds: string[],
    vars: NotificationTemplateVars[K],
    discriminator: string,
    tx?: DbExecutor,
  ): Promise<void> {
    await Promise.all(
      recipientIds.map((recipientId) =>
        this.notificationScheduler
          .schedule(
            {
              workspaceId: item.workspaceId,
              recipientId,
              actorId,
              template,
              vars,
              resourceId: item.id,
              // The relay writes idempotencyKey into in_app_notifications.source_event_id
              // (a UUID). Derive a deterministic UUID from the business-event key so
              // dedup still holds while satisfying the column type.
              idempotencyKey: stableEventId(
                `${template}:${item.id}:${recipientId}:${discriminator}`,
              ),
            },
            tx,
          )
          .catch((err: unknown) =>
            this.logger.warn(
              { err, template, workItemId: item.id, recipientId },
              'Failed to enqueue work-item notification',
            ),
          ),
      ),
    );
  }

  /**
   * F7 — fan out comment + mention notifications. Called by CollaborationService
   * after a comment is persisted. Auto-watches the commenter (BA rule).
   */
  async notifyCommentAdded(
    actor: JwtPayload,
    workItemId: string,
    mentionedUserIds: string[] = [],
  ): Promise<void> {
    const item = await this.getWorkItem(actor.workspaceId, workItemId);
    // Commenter auto-watches the item so they receive follow-up activity.
    await this.watcherRepo.watch(workItemId, actor.sub, actor.workspaceId).catch(() => undefined);

    const vars = { itemKey: item.itemKey, itemTitle: item.title, projectId: item.projectId };
    // FR-019: mentions may name anyone; keep only users who can access the project.
    const mentioned = await this.filterByProjectAccess(
      item.workspaceId,
      item.projectId,
      mentionedUserIds.filter((id) => id && id !== actor.sub),
    );

    // Mentions take precedence — a mentioned watcher gets the mention, not the
    // generic comment notification.
    if (mentioned.length > 0) {
      await this.emitWorkItemNotification(
        'WORK_ITEM_MENTIONED',
        item,
        actor.sub,
        mentioned,
        vars,
        workItemId,
      );
    }
    const commentRecipients = (
      await this.resolveRecipients(item, [item.assigneeId], actor.sub)
    ).filter((id) => !mentioned.includes(id));
    if (commentRecipients.length > 0) {
      await this.emitWorkItemNotification(
        'WORK_ITEM_COMMENTED',
        item,
        actor.sub,
        commentRecipients,
        vars,
        workItemId,
      );
    }
  }

  // ── Relations (F6 — work-item linking) ──────────────────────────────────────

  @Span('work-items.list-relations')
  async listRelations(actor: JwtPayload, id: string): Promise<WorkItemRelationView[]> {
    // Authorize a read on the item's own project (project isolation).
    await this.getWorkItemForView(actor, id);
    return this.relationRepo.listForItem(id, actor.workspaceId);
  }

  @Span('work-items.link')
  async linkWorkItem(
    actor: JwtPayload,
    sourceId: string,
    targetId: string,
    relationType: WorkItemRelationType,
  ): Promise<WorkItemRelationView[]> {
    // Editing the source item's links requires edit on its project.
    await this.getWorkItemForWrite(actor, sourceId, PERMISSION.WORK_ITEM_EDIT);

    if (sourceId === targetId) {
      throw new PreconditionFailedException(
        'WORK_ITEM_RELATION_SELF',
        'A work item cannot be linked to itself',
      );
    }

    // Target must exist within the same workspace (cross-project allowed).
    await this.getWorkItem(actor.workspaceId, targetId);

    if (await this.relationRepo.exists(sourceId, targetId, relationType, actor.workspaceId)) {
      throw new PreconditionFailedException(
        'WORK_ITEM_RELATION_EXISTS',
        'This relation already exists',
      );
    }

    // Guard against dependency cycles for ordering relations (blocks/depends_on).
    if (isAcyclicRelationType(relationType)) {
      const cycle = await this.relationRepo.wouldCreateCycle(
        sourceId,
        targetId,
        relationType,
        actor.workspaceId,
      );
      if (cycle) {
        throw new PreconditionFailedException(
          'WORK_ITEM_RELATION_CYCLE',
          `Adding this ${relationType} relation would create a dependency cycle`,
        );
      }
    }

    await this.relationRepo.create(
      { sourceItemId: sourceId, targetItemId: targetId, relationType, createdBy: actor.sub },
      actor.workspaceId,
    );

    const source = await this.getWorkItem(actor.workspaceId, sourceId);
    void this.activityRepo.append(
      this.buildActivityInput(source, 'work_item', actor.sub, 'work_item.relation_added', null, {
        relationType,
        targetId,
      }),
    );

    return this.relationRepo.listForItem(sourceId, actor.workspaceId);
  }

  @Span('work-items.unlink')
  async unlinkWorkItem(actor: JwtPayload, sourceId: string, relationId: string): Promise<void> {
    await this.getWorkItemForWrite(actor, sourceId, PERMISSION.WORK_ITEM_EDIT);
    const relation = await this.relationRepo.findById(relationId, actor.workspaceId);
    if (!relation) {
      throw new NotFoundException('WORK_ITEM_RELATION_NOT_FOUND', 'Relation not found');
    }
    // The relation must actually touch the source item (either end).
    if (relation.sourceItemId !== sourceId && relation.targetItemId !== sourceId) {
      throw new NotFoundException(
        'WORK_ITEM_RELATION_NOT_FOUND',
        'Relation does not belong to this work item',
      );
    }
    await this.relationRepo.delete(relationId, actor.workspaceId);

    const source = await this.getWorkItem(actor.workspaceId, sourceId);
    void this.activityRepo.append(
      this.buildActivityInput(source, 'work_item', actor.sub, 'work_item.relation_removed', null, {
        relationType: relation.relationType,
        relationId,
      }),
    );
  }

  // ── Move (board transition) ───────────────────────────────────────────────

  @Span('work-items.move')
  async moveWorkItem(actor: JwtPayload, id: string, toStatusId: string): Promise<WorkItem> {
    return this.updateWorkItem(actor, id, { statusId: toStatusId });
  }

  // ── Reorder (backlog drag-and-drop) ───────────────────────────────────────

  async reorderWorkItems(
    actor: JwtPayload,
    items: Array<{ id: string; rank: string }>,
  ): Promise<void> {
    if (items.length === 0) return;
    // Validate all items belong to this workspace before updating
    const existing = await Promise.all(
      items.map(({ id }) => this.getWorkItem(actor.workspaceId, id)),
    );
    if (existing.some((w) => w.workspaceId !== actor.workspaceId)) {
      throw new Error('Workspace mismatch');
    }
    // Authorize edit on every project the batch touches (usually one backlog).
    for (const projectId of new Set(existing.map((w) => w.projectId))) {
      await this.accessService.assertProjectPermission(actor, projectId, PERMISSION.WORK_ITEM_EDIT);
    }
    // Wrap in UoW so all rank UPDATEs are one atomic transaction with RLS active.
    await this.uow.run((tx) => this.workItemRepo.reorderItems(items, actor.workspaceId, tx));
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
    const item = await this.getWorkItemForWrite(actor, id, PERMISSION.WORK_ITEM_EDIT);
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
   * all-or-nothing transaction. Every item must be in the given workspace/project;
   * the release must belong to that project. Any violation fails the whole call.
   */
  @Span('work-items.bulk-release')
  async bulkAssignRelease(
    actor: JwtPayload,
    projectId: string,
    itemIds: string[],
    releaseId: string | null,
  ): Promise<number> {
    const items = await this.loadBulkItems(actor, projectId, itemIds);
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
   * given workspace/project; the iteration must share that project and, when the
   * iteration is team-scoped, the same team. Any violation fails the whole call.
   */
  @Span('work-items.bulk-iteration')
  async bulkAssignIteration(
    actor: JwtPayload,
    projectId: string,
    itemIds: string[],
    iterationId: string | null,
  ): Promise<number> {
    const items = await this.loadBulkItems(actor, projectId, itemIds);

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
   * be non-deleted, and belong to the given workspace/project. Fails the whole
   * request (all-or-nothing) if any id is missing or out of scope.
   */
  private async loadBulkItems(
    actor: JwtPayload,
    projectId: string,
    itemIds: string[],
  ): Promise<WorkItem[]> {
    await this.accessService.assertProjectPermission(actor, projectId, PERMISSION.WORK_ITEM_EDIT);
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) {
      throw new PreconditionFailedException('WORK_ITEM_EMPTY_SELECTION', 'No items selected');
    }
    const items = await this.workItemRepo.findByIds(ids, actor.workspaceId);
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
   * An iteration is assignable to a work item when it exists in the same workspace,
   * shares the item's project, and — if the iteration is team-scoped — shares
   * the item's team. Team-agnostic iterations (teamId null) accept any team.
   */
  private async assertIterationAssignable(
    workspaceId: string,
    item: Pick<WorkItem, 'projectId' | 'teamId'>,
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

  /** A release is assignable when it exists in the same workspace and project. */
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

  /**
   * The ONE guard every create/update path funnels its scoped references
   * through, so no mutation can silently skip validation and no rule is
   * duplicated per call site. Given the item's authoritative project and the
   * team it effectively has, it validates each *provided* reference:
   *   - team         → must be actively linked to the project (SRS P1-MANAGE-ORG)
   *   - iteration    → must share the project and, if team-scoped, the team
   *   - release      → must share the project
   *   - foundInRelease (defect) → must share the project (same rule as release)
   *   - member ids (assignee/reporter/devOwner) → must be active workspace members
   * `validateTeamLink` lets the update path pass the effective team for the
   * iteration match without re-checking a team that isn't changing. Callers pass
   * only the member ids that are new/changed so an unchanged assignee isn't
   * re-queried. Add a new scoped field here once and every mutation path is
   * covered.
   */
  private async assertAssignmentScope(
    workspaceId: string,
    scope: {
      projectId: string;
      teamId?: string | null;
      iterationId?: string | null;
      releaseId?: string | null;
      foundInReleaseId?: string | null;
      memberIds?: Array<string | null | undefined>;
    },
    opts: { validateTeamLink?: boolean } = {},
  ): Promise<void> {
    const validateTeamLink = opts.validateTeamLink ?? true;
    if (validateTeamLink && scope.teamId) {
      await this.projectsService.assertTeamLinkedToProject(
        workspaceId,
        scope.projectId,
        scope.teamId,
      );
    }
    if (scope.iterationId) {
      await this.assertIterationAssignable(
        workspaceId,
        { projectId: scope.projectId, teamId: scope.teamId ?? null },
        scope.iterationId,
      );
    }
    if (scope.releaseId) {
      await this.assertReleaseAssignable(workspaceId, scope.projectId, scope.releaseId);
    }
    if (scope.foundInReleaseId) {
      await this.assertReleaseAssignable(workspaceId, scope.projectId, scope.foundInReleaseId);
    }
    const memberIds = [
      ...new Set((scope.memberIds ?? []).filter((id): id is string => Boolean(id))),
    ];
    for (const userId of memberIds) {
      await this.projectsService.assertWorkspaceMember(workspaceId, userId);
    }
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  async getWorkItemLabels(
    actor: JwtPayload,
    id: string,
  ): Promise<Array<{ id: string; name: string; color: string }>> {
    await this.getWorkItemForView(actor, id);
    return this.workItemRepo.listLabels(id);
  }

  async addLabelToWorkItem(actor: JwtPayload, id: string, labelId: string): Promise<void> {
    const item = await this.getWorkItemForWrite(actor, id, PERMISSION.WORK_ITEM_EDIT);
    // P1-15: label must belong to the same project as the work item
    await this.projectsService.assertLabelBelongsToProject(item.projectId, labelId);
    await this.workItemRepo.addLabel(id, labelId, actor.workspaceId);
  }

  async removeLabelFromWorkItem(actor: JwtPayload, id: string, labelId: string): Promise<void> {
    await this.getWorkItemForWrite(actor, id, PERMISSION.WORK_ITEM_EDIT);
    await this.workItemRepo.removeLabel(id, labelId, actor.workspaceId);
  }

  // ── Milestones ──────────────────────────────────────────────────────────────

  async getWorkItemMilestones(
    actor: JwtPayload,
    id: string,
  ): Promise<Array<{ id: string; name: string }>> {
    await this.getWorkItemForView(actor, id);
    return this.workItemRepo.listMilestones(id);
  }

  /**
   * Replace-set of the milestones assigned to a work item. Every id must belong
   * to the work item's project (same-project guard, mirrors label validation).
   */
  async setWorkItemMilestones(
    actor: JwtPayload,
    id: string,
    milestoneIds: string[],
  ): Promise<Array<{ id: string; name: string }>> {
    const item = await this.getWorkItemForWrite(actor, id, PERMISSION.WORK_ITEM_EDIT);
    const uniqueIds = [...new Set(milestoneIds)];
    if (uniqueIds.length > 0) {
      const inProject = await this.workItemRepo.countMilestonesInProject(uniqueIds, item.projectId);
      if (inProject !== uniqueIds.length) {
        throw new PreconditionFailedException(
          'MILESTONE_PROJECT_MISMATCH',
          'One or more milestones do not belong to this work item\u2019s project',
        );
      }
    }
    await this.workItemRepo.setMilestones(id, uniqueIds);
    return this.workItemRepo.listMilestones(id);
  }

  // ── Time Logging ──────────────────────────────────────────────────────────

  @Span('work-items.list-time-logs')
  async listTimeLogs(
    actor: JwtPayload,
    workItemId: string,
    args: { page: number; pageSize: number },
  ): Promise<{ items: TimeLog[]; total: number }> {
    await this.getWorkItemForView(actor, workItemId);
    return this.timeLogRepo.listByWorkItem(workItemId, actor.workspaceId, {
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
    await this.getWorkItemForWrite(actor, workItemId, PERMISSION.WORK_ITEM_EDIT);
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
    this.watcherRepo.watch(workItemId, actor.sub, actor.workspaceId).catch((err: unknown) => {
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
    await this.getWorkItemForWrite(actor, workItemId, PERMISSION.WORK_ITEM_EDIT);
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
    await this.getWorkItemForWrite(actor, workItemId, PERMISSION.WORK_ITEM_EDIT);
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
  async listWatchers(actor: JwtPayload, workItemId: string): Promise<Watcher[]> {
    await this.getWorkItemForView(actor, workItemId);
    return this.watcherRepo.listByWorkItem(workItemId, actor.workspaceId);
  }

  @Span('work-items.watch')
  async watch(actor: JwtPayload, workItemId: string): Promise<void> {
    await this.getWorkItemForWrite(actor, workItemId, PERMISSION.WORK_ITEM_EDIT);
    await this.watcherRepo.watch(workItemId, actor.sub, actor.workspaceId);
  }

  @Span('work-items.unwatch')
  async unwatch(actor: JwtPayload, workItemId: string): Promise<void> {
    await this.getWorkItemForWrite(actor, workItemId, PERMISSION.WORK_ITEM_EDIT);
    await this.watcherRepo.unwatch(workItemId, actor.sub);
  }

  // ── Attachments ───────────────────────────────────────────────────────────
  //
  // Authorization lives here; the upload mechanics live in AttachmentsService.
  // These methods deliberately do nothing that another upload surface would also
  // have to do — that is what keeps a second surface to a policy descriptor plus
  // a link table.
  //
  // The file id is the public attachment id. Callers never see the link row.

  @Span('work-items.presign-attachment')
  async presignAttachment(
    actor: JwtPayload,
    workItemId: string,
    input: { filename: string; mimeType: string; sizeBytes: number; checksumSha256: string },
  ): Promise<{ attachmentId: string; uploadUrl: string; requiredHeaders: Record<string, string> }> {
    await this.getWorkItemForWrite(actor, workItemId, PERMISSION.WORK_ITEM_EDIT);

    const current = await this.attachmentRepo.countByWorkItem(workItemId, actor.workspaceId);

    const { fileId, uploadUrl, requiredHeaders } = await this.attachments.presign(
      actor,
      WORK_ITEM_ATTACHMENT_POLICY,
      input,
      current,
    );

    return { attachmentId: fileId, uploadUrl, requiredHeaders };
  }

  @Span('work-items.confirm-attachment')
  async confirmAttachment(
    actor: JwtPayload,
    workItemId: string,
    attachmentId: string,
  ): Promise<WorkItemAttachment> {
    const item = await this.getWorkItemForWrite(actor, workItemId, PERMISSION.WORK_ITEM_EDIT);

    // Verifies the object landed and matches the declared size + checksum.
    const file = await this.attachments.confirm(actor, attachmentId, WORK_ITEM_ATTACHMENT_POLICY);

    // Re-check the quota at confirm time: presign only reserved a row, and N
    // concurrent presigns could each have passed the check against the same
    // count. This is the point where the file becomes visible, so it is the
    // point that has to hold the limit.
    const current = await this.attachmentRepo.countByWorkItem(workItemId, actor.workspaceId);
    if (current >= (WORK_ITEM_ATTACHMENT_POLICY.maxPerOwner ?? Infinity)) {
      await this.attachments.softDelete(attachmentId);
      throw new PreconditionFailedException(
        'ATTACHMENT_LIMIT_EXCEEDED',
        `Work item already has the maximum of ${WORK_ITEM_ATTACHMENT_POLICY.maxPerOwner} attachments`,
      );
    }

    await this.attachmentRepo.link({
      workItemId,
      fileId: attachmentId,
      workspaceId: actor.workspaceId,
      attachedBy: actor.sub,
    });

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
      metadata: { filename: file.filename },
    });
    this.logger.log({ workItemId, attachmentId, filename: file.filename }, 'Attachment confirmed');

    return {
      id: file.id,
      workItemId,
      workspaceId: actor.workspaceId,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadedBy: file.uploadedBy,
      createdAt: file.createdAt,
    };
  }

  @Span('work-items.list-attachments')
  async listAttachments(actor: JwtPayload, workItemId: string): Promise<WorkItemAttachment[]> {
    await this.getWorkItemForView(actor, workItemId);
    return this.attachmentRepo.listByWorkItem(workItemId, actor.workspaceId);
  }

  @Span('work-items.get-attachment-download-url')
  async getAttachmentDownloadUrl(
    actor: JwtPayload,
    workItemId: string,
    attachmentId: string,
  ): Promise<{ downloadUrl: string }> {
    await this.getWorkItemForView(actor, workItemId);

    // Scoped to the work item, not just the workspace: without this a viewer of
    // work item A could mint a URL for an attachment on work item B in a project
    // they cannot see.
    const link = await this.attachmentRepo.findByWorkItemAndFile(
      workItemId,
      attachmentId,
      actor.workspaceId,
    );
    if (!link) {
      throw new NotFoundException('ATTACHMENT_NOT_FOUND', 'Attachment not found');
    }

    const { url } = await this.attachments.getDownloadUrl(
      actor,
      attachmentId,
      WORK_ITEM_ATTACHMENT_POLICY,
    );
    return { downloadUrl: url };
  }

  @Span('work-items.delete-attachment')
  async deleteAttachment(
    actor: JwtPayload,
    workItemId: string,
    attachmentId: string,
  ): Promise<void> {
    const item = await this.getWorkItemForWrite(actor, workItemId, PERMISSION.WORK_ITEM_EDIT);

    const link = await this.attachmentRepo.findByWorkItemAndFile(
      workItemId,
      attachmentId,
      actor.workspaceId,
    );
    if (!link) {
      throw new NotFoundException('ATTACHMENT_NOT_FOUND', 'Attachment not found');
    }

    const isAdmin = actor.permissions?.includes('workspace:*');
    if (!isAdmin && link.uploadedBy !== actor.sub) {
      throw new PermissionDeniedException(
        'ATTACHMENT_NOT_OWNER',
        'Only the uploader or a workspace admin may delete this attachment',
      );
    }

    await this.attachmentRepo.unlink(workItemId, attachmentId, actor.workspaceId);
    // Soft-delete the file too. The object itself is removed by the worker
    // reaper, which is the only place that can see whether some other link row
    // still references it.
    await this.attachments.softDelete(attachmentId);

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
      metadata: { filename: link.filename },
    });
    this.logger.log({ workItemId, attachmentId, filename: link.filename }, 'Attachment deleted');
  }
}
