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
import { PERMISSION, type ProjectPermission } from '@shared-kernel';
import { isAcceptedScheduleState } from '../../../../../db/schema/enums';
import { NotificationSchedulerService } from '@platform/notifications/notification-scheduler.service';
import type {
  NotificationTemplateName,
  NotificationTemplateVars,
} from '@platform/notifications/notification.templates';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
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
import type { Attachment } from '../domain/attachment.types';
import { diffWorkItem } from './activity-diff';
import { StorageService } from '@platform';
import {
  ATTACHMENT_ALLOWED_MIME_TYPES,
  ATTACHMENT_MAX_PER_WORK_ITEM,
  ATTACHMENT_MAX_SIZE_BYTES,
} from '../domain/attachment.rules';

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
  storyPoints?: number;
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
    private readonly storageService: StorageService,
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
    const project = await this.projectsService.getProject(actor.workspaceId, projectId);
    await this.accessService.assertProjectPermission(actor, projectId, PERMISSION.WORK_ITEM_CREATE);

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
    if (opts.teamId) {
      await this.assertTeamLinked(actor.workspaceId, projectId, opts.teamId);
    }

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
              estimateHours: opts.estimateHours,
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

    // P3.4 — Validate defect state transitions
    if (input.defectState !== undefined && input.defectState !== null && item.defectState) {
      const validTransitions: Record<string, string[]> = {
        submitted: ['open', 'closed_declined'],
        open: ['fixed'],
        fixed: ['closed'],
        closed: ['open'],
        closed_declined: ['open'],
      };
      const allowed = validTransitions[item.defectState] ?? [];
      if (!allowed.includes(input.defectState)) {
        throw new PreconditionFailedException(
          'WORK_ITEM_INVALID_TRANSITION',
          `Invalid defect state transition: ${item.defectState} → ${input.defectState}. Allowed: ${allowed.join(', ') || 'none'}`,
        );
      }
    }

    const isTask = item.type === 'task';
    const taskTransitioningToComplete =
      isTask && input.scheduleState === 'completed' && item.scheduleState !== 'completed';

    // ── Auto-set To Do to 0 when a task is moved to Completed ──
    if (taskTransitioningToComplete) {
      input.todoHours = '0';
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
          if (parentBefore && parentBefore.scheduleState !== 'completed') {
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

      return updated;
    });

    // ── F7 notifications (best-effort, post-commit) ──
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
          { itemKey: updated.itemKey, itemTitle: updated.title },
          updated.assigneeId,
        );
      }
    }

    // Schedule-state change: notify watchers ∪ assignee (minus the actor).
    if (input.scheduleState !== undefined && updated.scheduleState !== item.scheduleState) {
      const recipients = await this.resolveRecipients(updated.id, [updated.assigneeId], actor.sub);
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
          },
          updated.scheduleState,
        );
      }
    }

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

  /** Watchers ∪ extra recipients, de-duplicated, with the actor removed. */
  private async resolveRecipients(
    workItemId: string,
    extra: (string | null | undefined)[],
    actorId: string,
  ): Promise<string[]> {
    const watchers = await this.watcherRepo.listUserIds(workItemId);
    const set = new Set<string>(watchers);
    for (const id of extra) if (id) set.add(id);
    set.delete(actorId);
    return [...set];
  }

  private async emitWorkItemNotification<K extends NotificationTemplateName>(
    template: K,
    item: WorkItem,
    actorId: string,
    recipientIds: string[],
    vars: NotificationTemplateVars[K],
    discriminator: string,
  ): Promise<void> {
    await Promise.all(
      recipientIds.map((recipientId) =>
        this.notificationScheduler
          .schedule({
            workspaceId: item.workspaceId,
            recipientId,
            actorId,
            template,
            vars,
            resourceId: item.id,
            idempotencyKey: `${template}:${item.id}:${recipientId}:${discriminator}`,
          })
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

    const vars = { itemKey: item.itemKey, itemTitle: item.title };
    const mentioned = mentionedUserIds.filter((id) => id && id !== actor.sub);

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
      await this.resolveRecipients(workItemId, [item.assigneeId], actor.sub)
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

  @Span('work-items.presign-attachment')
  async presignAttachment(
    actor: JwtPayload,
    workItemId: string,
    input: { filename: string; mimeType: string; sizeBytes: number },
  ): Promise<{ attachmentId: string; uploadUrl: string }> {
    await this.getWorkItemForWrite(actor, workItemId, PERMISSION.WORK_ITEM_EDIT);

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

    const { uploadUrl } = await this.storageService.presignPut(
      storageKey,
      input.mimeType,
      input.sizeBytes,
    );
    return { attachmentId: id, uploadUrl };
  }

  @Span('work-items.confirm-attachment')
  async confirmAttachment(
    actor: JwtPayload,
    workItemId: string,
    attachmentId: string,
  ): Promise<Attachment> {
    const item = await this.getWorkItemForWrite(actor, workItemId, PERMISSION.WORK_ITEM_EDIT);

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
    this.logger.log(
      { workItemId, attachmentId, filename: attachment.filename },
      'Attachment confirmed',
    );
    return confirmed;
  }

  @Span('work-items.list-attachments')
  async listAttachments(actor: JwtPayload, workItemId: string): Promise<Attachment[]> {
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

    const attachment = await this.attachmentRepo.findById(attachmentId, actor.workspaceId);
    if (!attachment || attachment.workItemId !== workItemId || attachment.status !== 'completed') {
      throw new NotFoundException('ATTACHMENT_NOT_FOUND', 'Attachment not found');
    }

    const downloadUrl = await this.storageService.presignGet(attachment.storageKey);
    return { downloadUrl };
  }

  @Span('work-items.delete-attachment')
  async deleteAttachment(
    actor: JwtPayload,
    workItemId: string,
    attachmentId: string,
  ): Promise<void> {
    const item = await this.getWorkItemForWrite(actor, workItemId, PERMISSION.WORK_ITEM_EDIT);

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
    this.logger.log(
      { workItemId, attachmentId, filename: attachment.filename },
      'Attachment deleted',
    );
  }
}
