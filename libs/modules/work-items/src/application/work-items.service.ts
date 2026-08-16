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
import { PERMISSION, permissionGrants } from '@shared-kernel';
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
import { MilestonesService } from '@modules/milestones';
import { IWorkItemRepository, WORK_ITEM_REPOSITORY } from '../domain/ports/work-item.repository';
import {
  ActivityLogger,
  type ActivityChange,
  type ActivityEntityType,
  type ActivityLog,
  type CreateActivityInput,
} from '@modules/activity';
import { ITimeLogRepository, TIME_LOG_REPOSITORY } from '../domain/ports/time-log.repository';
import { IWatcherRepository, WATCHER_REPOSITORY } from '../domain/ports/watcher.repository';
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
  MyWorkItem,
  WorkspaceSummary,
} from '../domain/work-item.types';
import type { TimeLog } from '../domain/time-log.types';
import type { Watcher } from '../domain/watcher.types';
import { diffWorkItem } from './activity-diff';
import { EntityAttachmentsService } from '@modules/attachments';
import type { AttachmentRef, EntityAttachment } from '@modules/attachments';

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

/**
 * The per-EVENT half of an assignment notification's idempotency key.
 *
 * `P4-NOTIF-FR-021` scopes idempotency to the "same event-recipient pair"
 * (`Phase 4/01_Notifications/SRS.md:103`). The assignment key used to pass `item.assigneeId` as its
 * discriminator — which IS the recipient — so the key collapsed to (template, item, user), and
 * because `messaging.notification_outbox.idempotency_key` is UNIQUE under `onConflictDoNothing`
 * (and the relay copies it into `in_app_notifications.source_event_id`, UNIQUE as
 * `uq_ian_source_event_id`), suppression was PERMANENT rather than per event: assign an item to A,
 * then to B, then back to A, and A is notified exactly once in that item's whole lifetime.
 *
 * `updatedAt` IS the assignment event's identity. The repository writes it once per update and both
 * of its branches return the stored row (`work_items` via `RETURNING`, `work.tasks` via a re-read
 * on the same executor), so the value read here is the POST-write one, not a pre-update copy — and
 * it is fixed for the whole transaction the outbox insert shares.
 *
 * **RETRY-SAFETY, the property this key exists for and must keep:** a retry of the SAME assignment
 * reuses the same stamp and therefore the same key, so the relay re-processing an outbox row and
 * `createWorkItem`'s duplicate-key retry loop both still de-dupe. A LATER assignment carries a
 * later stamp and gets through. Never substitute `Date.now()` or `randomUUID()` here — either makes
 * every retry look like a new event and turns FR-021 inside out.
 *
 * ISO and not `String(date)`, because `Date#toString` rounds to the second and would re-collapse
 * two assignments landing inside the same second. A non-`Date` value degrades to the old
 * item-scoped key instead of throwing: the key is built INSIDE the business transaction, and a
 * notification detail must never be able to roll back the assignment it describes.
 */
function assignmentEventStamp(item: WorkItem): string {
  const at: unknown = item.updatedAt;
  if (at instanceof Date) return Number.isNaN(at.getTime()) ? '' : at.toISOString();
  return typeof at === 'string' || typeof at === 'number' ? String(at) : '';
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
    private readonly activity: ActivityLogger,
    @Inject(TIME_LOG_REPOSITORY) private readonly timeLogRepo: ITimeLogRepository,
    @Inject(WATCHER_REPOSITORY) private readonly watcherRepo: IWatcherRepository,
    @Inject(WORK_ITEM_RELATION_REPOSITORY)
    private readonly relationRepo: IWorkItemRelationRepository,
    private readonly notificationScheduler: NotificationSchedulerService,
    private readonly entityAttachments: EntityAttachmentsService,
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
    // Owns the milestone-artifact scope rule; see setWorkItemMilestones.
    private readonly milestonesService: MilestonesService,
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
    action: string,
    changes: ActivityChange | null,
    metadata: Record<string, unknown> = {},
  ): CreateActivityInput {
    return this.activity.build(
      {
        workspaceId: item.workspaceId,
        projectId: item.projectId,
        entityType,
        entityId: item.id,
        // Anchor task entries to the parent so the item history shows them too.
        contextId: entityType === 'task' ? (item.parentId ?? item.id) : item.id,
      },
      actorId,
      action,
      changes,
      metadata,
    );
  }

  /** Batched append participating in the caller's transaction (shared logger). */
  private appendMany(inputs: CreateActivityInput[], tx?: DbExecutor): Promise<void> {
    return this.activity.log(inputs, { tx });
  }

  /** Single entry — used for created/deleted events where there is only one entry. */
  private async appendActivity(
    tx: DbExecutor,
    item: WorkItem,
    entityType: ActivityEntityType,
    actorId: string,
    action: string,
    changes: ActivityChange | null,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.appendMany(
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

  /** Home "My Work" widget — top-N items assigned to the actor, workspace-wide. */
  async listMyWork(actor: JwtPayload, limit: number): Promise<MyWorkItem[]> {
    return this.workItemRepo.listMyWork(actor.workspaceId, actor.sub, { limit });
  }

  /** Home summary strip — exact workspace-wide counts (one batched query set). */
  async getWorkspaceSummary(actor: JwtPayload): Promise<WorkspaceSummary> {
    return this.workItemRepo.getWorkspaceSummary(actor.workspaceId, actor.sub);
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

  /**
   * An archived project is read-only end to end (PRJ-FR-010). The project record and key-gen were
   * guarded, but its CONTENT stayed fully writable — archive then did nothing to stop edits inside
   * the project. Every write path resolves the project anyway, so this check costs no extra query.
   *
   * A DELEGATION, not an implementation. This used to be a copy of
   * `ProjectsService.assertProjectWritable`'s body, and a second home for one rule is why the rule
   * kept drifting: the copy was reached by three methods here while ~19 secondary writes in the
   * same class reached neither it nor the original, and five other modules had no check at all. The
   * wrapper stays only so the call sites below read the same as they did — the code and the message
   * now live in exactly one place, and `void` is deliberate because nothing here wants the row.
   */
  private async assertProjectWritable(workspaceId: string, projectId: string): Promise<void> {
    await this.projectsService.assertProjectWritable(workspaceId, projectId);
  }

  @Span('work-items.create')
  async createWorkItem(
    actor: JwtPayload,
    projectId: string,
    type: WorkItemType,
    title: string,
    opts: CreateWorkItemOpts = {},
  ): Promise<WorkItem> {
    await this.assertProjectWritable(actor.workspaceId, projectId);

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
      // Tasks can only sit under a Work Product — a story or defect (DB design
      // §Work item hierarchy: Story → Task, and task.parent_id → Story/Defect).
      if (type === 'task' && parent.type !== 'story' && parent.type !== 'defect') {
        throw new PreconditionFailedException(
          'WORK_ITEM_INVALID_PARENT_TYPE',
          'A task can only be created under a user story or defect',
        );
      }
      /**
       * A Task carries NO iteration into the write at all (P1-TASK-011, P2-IS-024).
       *
       * Not "must equal the parent's" — that would still be a value the caller owns, and the
       * contract is that it owns none. `trg_task_iteration_from_parent` fills the column from
       * `parent_id` on insert, and the insert uses `RETURNING`, so the created row comes back
       * already carrying the parent's iteration.
       *
       * The guard is here as well as in `createTask` because this method is reachable on its own:
       * `POST /work-items` with `type: 'task'` skips that wrapper entirely, so a refusal only there
       * would be a front door with a lock beside a side door without one.
       */
      if (type === 'task' && opts.iterationId !== undefined) {
        throw new PreconditionFailedException(
          'TASK_ITERATION_DERIVED',
          "A task's iteration follows its parent story or defect and cannot be set directly.",
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

    // A task ALWAYS belongs to a Work Product (parent_id is NOT NULL for tasks).
    // Reject a missing parent with a clean 422 instead of letting the repo hit a
    // NOT-NULL violation downstream.
    if (type === 'task' && !opts.parentId) {
      throw new PreconditionFailedException(
        'WORK_ITEM_INVALID_PARENT_TYPE',
        'A task must be created under a user story or defect',
      );
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
      // A create always states both facts, so the owner/team pair is always judged.
      assigneeId: opts.assigneeId ?? null,
    });
    // An `AccessService.assertTeamScoped` call sat here (and on update and delete). Team scope was
    // deleted as an authorization boundary by ruling — see that method's former home in
    // `access.service.ts` for the reasoning. `assertAssignmentScope` above still validates that the
    // team, iteration and release BELONG to this project; what is gone is the separate question of
    // whether the ACTOR is on the team.

    // Rank is assigned INSIDE the transaction below, under a per-scope advisory
    // lock — see the `create` call. It used to be computed here, on the pool
    // connection, before the transaction opened: a plain read-modify-write with
    // no lock, so two creates in the same project could both read the same max
    // and derive the same rank. That is not hypothetical — this database holds 22
    // scopes where a story and a defect share rank 'i', and equal neighbours make
    // `between()` throw LEXORANK_NEIGHBOURS_OUT_OF_ORDER on the next drag-reorder.

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
          // Serialise rank assignment for this (project, parent) scope. The lock
          // is transaction-scoped, so it releases on commit or rollback, and it
          // only blocks other creates in the SAME scope. Both the read and the
          // insert now happen on `tx`, so the max cannot go stale between them.
          const rankScope = { projectId, parentId: opts.parentId ?? null };
          await this.workItemRepo.lockRankScope(rankScope, tx);
          const maxRank = await this.workItemRepo.findMaxRank(rankScope, actor.workspaceId, tx);
          // New items append to the end of their scope's order (top-level
          // backlog, or the parent's task list). A degenerate '' rank would sort
          // correctly once but corrupt subsequent between() math on drag-reorder.
          const rank = between(maxRank, null);

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
              // SoT §2.4: a new Story/Defect defaults Schedule=Flow='idea'
              // (Tasks have their own lifecycle starting at 'defined'). Flow
              // mirrors Schedule at create (BR-WI-01) so the pair is never split.
              scheduleState: opts.scheduleState ?? (type === 'task' ? 'defined' : 'idea'),
              flowState: opts.scheduleState ?? (type === 'task' ? 'defined' : 'idea'),
              priority: opts.priority ?? 'none',
              assigneeId: opts.assigneeId,
              reporterId: opts.reporterId ?? actor.sub,
              parentId: opts.parentId,
              teamId: opts.teamId,
              iterationId: opts.iterationId,
              releaseId: opts.releaseId,
              storyPoints: opts.storyPoints,
              // The ONE automatic time-field move, and it happens HERE only:
              // "**On create only**, when Estimate is entered and To Do is blank,
              // the system copies Estimate to To Do once"
              // (`Phase 1/04_Task_Management/SRS.md:26`). `??` and not `||`, because
              // "An explicitly entered To Do is not overwritten" and `0` is an
              // explicit answer. After this row exists, all three fields are
              // independent — `updateWorkItem` derives nothing.
              estimateHours: opts.estimateHours,
              todoHours: type === 'task' ? (opts.todoHours ?? opts.estimateHours) : opts.todoHours,
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

          /**
           * "Assign on create" must notify exactly like "assign after create".
           *
           * `updateWorkItem` emitted `WORK_ITEM_ASSIGNED` on an assignee change and this path
           * emitted nothing, so an item created ALREADY assigned — which every Add-Item dialog
           * and the Tasks tab do, and which `createTask` does implicitly by inheriting the
           * parent's assignee — told the assignee nothing at all. Same event, same taxonomy
           * (SRS §5: `assigned` + `mention`), reached by a different verb; the notification is a
           * property of the assignment, not of the endpoint.
           *
           * On the same `tx` as the insert, so a rolled-back create leaves no ghost
           * notification — and inside the retry loop, so a duplicate-key retry re-emits with
           * the row that actually committed.
           */
          await this.notifyAssignee(actor, created, tx);

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
      // No `iterationId`: a Task inherits it through its parent (P1-TASK-011), so passing one is a
      // compile error rather than a runtime refusal. `teamId` stays — a Task's team only DEFAULTS to
      // its parent's and is genuinely settable (SRS P1-04).
      estimateHours?: string;
      todoHours?: string;
      actualHours?: string;
    } = {},
  ): Promise<WorkItem> {
    const parent = await this.getWorkItem(actor.workspaceId, parentId);
    // A task's parent must be a Work Product — a story or defect (never another
    // task, and never an initiative/feature). Matches the generic create guard.
    if (parent.type !== 'story' && parent.type !== 'defect') {
      throw new PreconditionFailedException(
        'WORK_ITEM_INVALID_PARENT_TYPE',
        'A task can only be created under a user story or defect',
      );
    }

    // Delegate to the work-item create flow — the task is created in the
    // dedicated tasks table by the repository layer when type='task'.
    // For now, we still write through the work_items table for backward
    // compatibility, but the service interface accepts the new shape.
    //
    // No `iterationId` is passed and none is accepted: this was
    // `opts.iterationId ?? parent.iterationId`, so a caller's value simply won and the Task started
    // life in a different sprint from its Story — the state P1-TASK-011 and P2-IS-024 both rule out.
    // `createWorkItem` refuses one for a task and the trigger fills the column from the parent.
    return this.createWorkItem(actor, parent.projectId, 'task', title, {
      ...opts,
      parentId: parent.id,
      // Owner is NOT inherited from the parent, and that absence is the point.
      // GAP-P1-WID-007 states the rule without a carve-out — "Work Item and Task Owner default to
      // Unassigned" — and where the BA wants a field derived from the parent it says so in words:
      // three times for Iteration (P1-TASK-011, P2-IS-024), explicitly for Team (P1-04, just below).
      // It wrote no such sentence for Owner.
      //
      // This used to be `opts.assigneeId ?? parent.assigneeId`, and because `CreateTaskSchema`'s
      // `assigneeId` is `.optional()` and NOT `.nullable()` (unlike the update DTO), there was NO WAY
      // through the API to create a genuinely unowned task under an owned Story. So Team Capacity's
      // `Unassigned` row and Team Status's Unassigned group could never show a real planning gap —
      // which is exactly what P6-TC-007 reported as "a null-owner Task attributed to a named member".
      // The projection was innocent; every task simply had an owner nobody chose.
      //
      // It is also unlike the two fields it sat between. Team and Iteration decide WHICH timebox and
      // roster the work belongs to, and the app actively keeps them in step (ITERATION_TEAM_MISMATCH,
      // trg_task_iteration_from_parent, trg_cascade_iteration_to_tasks). Nothing ties a task's owner
      // to its parent's, so the two diverged one edit later — a derived value with no maintainer.
      // Splitting a Story into five tasks assigned all five to whoever owned the Story, who is
      // usually the person breaking the work down rather than the person doing it.
      //
      // The convenience it bought is better spent as a VISIBLE prefill in the Add Task modal, where
      // the reader can see it and change it, than as a server default they can neither see nor refuse.
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
   * Load a work item for a READ and authorize the actor against the item's OWN
   * project via `work_item:view`. Now that the PolicyGuard authorizes the route
   * id up-front, this remains only for SECONDARY targets a route-scoped guard
   * cannot see — e.g. the far end of a relation link, where the actor must be
   * able to view the target too or linking would leak its key/title/state.
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
  async getWorkItemByKey(actor: JwtPayload, itemKey: string): Promise<WorkItem> {
    // Keys are workspace-unique (Rally FormattedID): resolve across the workspace,
    // then enforce view permission on the item's OWN project below.
    const item = await this.workItemRepo.findByKey(itemKey, actor.workspaceId);
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
    await this.getWorkItem(actor.workspaceId, parentId);
    return this.workItemRepo.listTasksByParent(parentId, actor.workspaceId);
  }

  async getTaskTotals(actor: JwtPayload, parentId: string): Promise<TaskTotals> {
    await this.getWorkItem(actor.workspaceId, parentId);
    return this.workItemRepo.getTaskTotals(parentId, actor.workspaceId);
  }

  // ── Activity (Revision History) ──────────────────────────────────────────────

  async getActivity(
    actor: JwtPayload,
    workItemId: string,
    args: { limit: number; offset: number },
  ): Promise<{ items: ActivityLog[]; total: number }> {
    await this.getWorkItem(actor.workspaceId, workItemId);
    const page = Math.floor(args.offset / args.limit) + 1;
    const res = await this.activity.listFor(workItemId, actor.workspaceId, page, args.limit);
    return { items: res.data, total: res.total };
  }

  // ── Update ────────────────────────────────────────────────────────────────

  @Span('work-items.update')
  async updateWorkItem(
    actor: JwtPayload,
    id: string,
    input: UpdateWorkItemInput,
  ): Promise<WorkItem> {
    const item = await this.getWorkItem(actor.workspaceId, id);
    await this.assertProjectWritable(actor.workspaceId, item.projectId);

    // BL §8:294 — an Editor "cannot assign Release". Field-level, because the route is gated on
    // `work_item:edit`, which an Editor holds for every other field in the same body. Only when the
    // patch actually MOVES the release: an unrelated edit on an item that already sits in one must not
    // be refused. See `assertMayAssignRelease` for why this lands now rather than earlier.
    if (input.releaseId !== undefined && input.releaseId !== item.releaseId) {
      await this.assertMayAssignRelease(actor, item.projectId);
    }

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
      if (newParent.type !== 'story' && newParent.type !== 'defect') {
        throw new PreconditionFailedException(
          'WORK_ITEM_INVALID_PARENT_TYPE',
          'A task can only belong to a user story or defect',
        );
      }
    }

    // A defect's User Story (parent_id) can be (re)assigned or cleared. Unlike a
    // task, a defect MAY be unparented (null), but when set the parent must be a
    // user story in the SAME project — mirrors the create-time rule so the
    // "User Story" association can never drift to a non-story or cross-project
    // item (work item hierarchy: Story → Defect).
    if (
      item.type === 'defect' &&
      input.parentId !== undefined &&
      input.parentId !== item.parentId &&
      input.parentId !== null
    ) {
      const newParent = await this.getWorkItem(actor.workspaceId, input.parentId);
      if (newParent.projectId !== item.projectId) {
        throw new PreconditionFailedException(
          'WORK_ITEM_PARENT_SCOPE_MISMATCH',
          'User story does not belong to the same project',
        );
      }
      if (newParent.type !== 'story') {
        throw new PreconditionFailedException(
          'WORK_ITEM_INVALID_PARENT_TYPE',
          'A defect can only be linked to a user story',
        );
      }
    }

    // Only tasks and defects carry a parent (DB design §Work item hierarchy).
    // Reject any attempt to SET a parent on an initiative / feature / story via
    // the API — mirrors the create-path rule so update can't back-door a parent
    // (or a self-parent / cross-project parent) that create forbids. Portfolio
    // hierarchy editing for these types is out of Phase 1 scope.
    if (
      item.type !== 'task' &&
      item.type !== 'defect' &&
      input.parentId !== undefined &&
      input.parentId !== null &&
      input.parentId !== item.parentId
    ) {
      throw new PreconditionFailedException(
        'WORK_ITEM_INVALID_PARENT_TYPE',
        'Only defects and tasks can have a parent work item',
      );
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

    /**
     * A Task has NO Iteration of its own to set (P1-TASK-011, P2-IS-024).
     *
     * The BA says it three times and real Rally shows the field read-only: a Task inherits its
     * Iteration through its parent Story/Defect, and has "no independent Iteration selector". The
     * value is maintained by `trg_task_iteration_from_parent`, so this patch could not take effect
     * anyway — which is precisely why it REFUSES rather than ignores. An endpoint that accepts a
     * field and silently discards it teaches a caller that the write worked; the next read would say
     * otherwise and the trigger would look like the bug.
     *
     * Move the parent instead: `trg_cascade_iteration_to_tasks` takes the tasks with it.
     */
    if (item.type === 'task' && input.iterationId !== undefined) {
      throw new PreconditionFailedException(
        'TASK_ITERATION_DERIVED',
        "A task's iteration follows its parent story or defect and cannot be set directly. Move the parent instead.",
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
    if (input.featureId) {
      await this.assertFeatureLinkable(actor.workspaceId, item.type, input.featureId);
    }

    const effectiveTeamId = input.teamId !== undefined ? input.teamId : item.teamId;
    // The `assertTeamScoped` call that sat here is gone (ruling, 2026-08-14 — see its former home in
    // `access.service.ts`). `effectiveTeamId` is still needed below: it is what
    // `assertIterationAssignable` validates the iteration against.
    /**
     * A TEAM change revalidates the iteration the item already sits in.
     *
     * `iterationId: input.iterationId ?? null` skipped `assertIterationAssignable` whenever the
     * patch did not mention an iteration, so moving an item to another team left it parked in the
     * old team's iteration — the exact state `ITERATION_TEAM_MISMATCH` exists to refuse, reachable
     * in two steps instead of one. The seeded database already contains one (`US-D2`, Team Beta,
     * in Team Alpha's Sprint 26.1) and the Phase 6 reports attribute its points by the iteration,
     * so it counted as Alpha's.
     *
     * Only when the team is actually changing. Re-checking on every unrelated patch would start
     * refusing a title edit on an item whose team and iteration already disagree — a real state
     * in existing data, and not this patch's fault to reject.
     */
    const effectiveIterationId =
      input.iterationId ?? (input.teamId !== undefined ? item.iterationId : null);
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
        iterationId: effectiveIterationId,
        releaseId: input.releaseId ?? null,
        foundInReleaseId: input.foundInReleaseId ?? null,
        memberIds: changedMemberIds,
        // The pair the item WILL have, and only when one half of it is moving. A team change has to
        // re-judge an UNCHANGED owner — otherwise the forbidden state is reachable in two steps
        // (name an owner, then move the item to a team they are not on), exactly the two-step hole
        // `ITERATION_TEAM_MISMATCH` had.
        assigneeId:
          input.assigneeId !== undefined || input.teamId !== undefined
            ? input.assigneeId !== undefined
              ? input.assigneeId
              : item.assigneeId
            : undefined,
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

    /**
     * NOTHING is derived here. `Estimate`, `To Do` and `Actual` are three independent editable
     * hour fields and the ONLY automatic move is the create-path copy (see `createWorkItem`).
     *
     * Two writes used to live at this spot and the BA has REVERSED both:
     *
     *  - a complete → `todoHours = '0'` auto-zero. `Phase 1/04_Task_Management/SRS.md:27` —
     *    "Completing or reopening a Task does not change any of the three values"; `:127` and
     *    `Phase 1/05_Time_Tracking/SRS.md:91` ("The only automatic time-field behavior is the
     *    create-time Estimate-to-To Do copy"); `Phase 6/04_Team_Capacity/SRS.md:52` and its AC-8.
     *    Note the gate was `isCompletedScheduleState`, which covers `completed | accepted | release`,
     *    so `accepted` and `release` auto-zeroed too — three transitions, not one.
     *  - a first-Estimate copy on UPDATE. `:26` scopes that copy to "**On create only**" and `:127`
     *    says it is "not repeated on later edits".
     *
     * EXISTING ROWS ARE LEFT ALONE and there is deliberately no backfill migration: a stored `0`
     * from the auto-zero is indistinguishable from a `0` a planner typed, so repairing history would
     * guess. Whether pre-existing auto-zeroed tasks should be restored is a BA question.
     *
     * Forward consequence, stated because four surfaces move with it: for tasks completed from now
     * on, To Do keeps its remaining value, so the Iteration Status To Do total, the Tasks-tab total,
     * Team Status and the next Burndown snapshot all read higher than they used to.
     */

    const entries = diffWorkItem(item, input, isTask);

    const updated = await this.uow.run(async (tx) => {
      // Re-parenting moves the item into a DIFFERENT rank scope, and a rank only
      // orders items within one scope. Carrying the old value across means it
      // lands at an arbitrary position, and usually collides: a defect ranked
      // first under story A keeps that rank when re-parented to story B or back
      // to top level, where the first item already holds it. Re-append it to the
      // end of the destination scope instead, under the same per-scope lock the
      // create path uses.
      const reparenting = input.parentId !== undefined && input.parentId !== item.parentId;
      let rerank: { rank: string } | Record<string, never> = {};
      if (reparenting) {
        const destination = { projectId: item.projectId, parentId: input.parentId ?? null };
        await this.workItemRepo.lockRankScope(destination, tx);
        const maxRank = await this.workItemRepo.findMaxRank(destination, actor.workspaceId, tx);
        rerank = { rank: between(maxRank, null) };
      }

      const updatedInTx = await this.workItemRepo.update(
        id,
        { ...input, ...rerank, ...clearReasonOnUnblock(input), updatedBy: actor.sub },
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
      await this.appendMany(activityInputs, tx);

      /**
       * ── Auto-accept: re-evaluate the RULE, not just the write that used to trigger it ──
       *
       * "A non-empty Iteration auto-changes to `Accepted` when all ASSIGNED Story/Defect items are
       * `Accepted`" (BUSINESS_BASELINE:12, BR-IT-02). That is a condition over an iteration's
       * MEMBERSHIP, so every write that can change membership has to re-check it — not only a write
       * that changes a status.
       *
       * This used to require `input.scheduleState` to transition into an accepted state, which left
       * two reachable holes: move the last open Story OUT of an otherwise-accepted iteration, or move
       * an already-accepted Story IN. Both end in exactly the state the rule describes with the
       * iteration still Committed — Timeboxes saying Committed while the Iteration Status tile says
       * ACCEPTED 100%. The BA logged that pairing as DEV-021; the status path was fixed and the scope
       * path was not.
       *
       * BOTH iterations are re-checked on a move: the one the item left may now be complete, and the
       * one it joined may be. `autoAcceptIterationIfComplete` owns the guards (non-empty, all
       * accepted, `planning|committed → accepted` only), so this never auto-REVERSES — which
       * BUSINESS_BASELINE:12 also requires, and which is what makes it safe to run on every move.
       */
      const acceptedTransition =
        input.scheduleState !== undefined &&
        isAcceptedScheduleState(input.scheduleState) &&
        !isAcceptedScheduleState(item.scheduleState);
      const iterationChanged =
        input.iterationId !== undefined && input.iterationId !== item.iterationId;

      if (!isTask && (acceptedTransition || iterationChanged)) {
        const affected = new Set(
          [item.iterationId, input.iterationId !== undefined ? input.iterationId : item.iterationId]
            // `null` is the Backlog, which has no acceptance state of its own.
            .filter((id): id is string => typeof id === 'string'),
        );
        for (const iterationId of affected) {
          const flipped = await this.workItemRepo.autoAcceptIterationIfComplete(
            iterationId,
            actor.workspaceId,
            tx,
          );
          if (flipped) {
            this.logger.log(
              { iterationId },
              'Iteration auto-accepted — all assigned Story/Defect items are accepted',
            );
          }
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
              await this.appendMany(
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

      // ── Reverse roll-up (BR-TASK-02 / P3-TS-FR-041): reopening a child task
      // moves its parent back to In-Progress from ANY at-or-past-completed state
      // — `completed`, `accepted` OR `release`. Real Rally keeps the parent's
      // Schedule State consistent with its tasks ("otherwise → In Progress") and
      // overrides a manual promotion, so `Accepted` is NOT exempt (BA-confirmed
      // 2026-07-24, superseding the earlier F3 accepted-exempt guard). The repo
      // mirrors Flow State too.
      if (taskTransitioningFromComplete && item.parentId) {
        const parentBefore = await this.workItemRepo.findById(item.parentId, actor.workspaceId, tx);
        if (parentBefore && isCompletedScheduleState(parentBefore.scheduleState)) {
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
            await this.appendMany(
              [
                this.buildActivityInput(
                  freshParent,
                  'work_item',
                  actor.sub,
                  'work_item.schedule_state_changed',
                  {
                    field: 'scheduleState',
                    old: parentBefore.scheduleState,
                    new: 'in_progress',
                  },
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
        await this.notifyAssignee(actor, updated, tx);
      }

      // NOTE: schedule-state changes intentionally do NOT notify. The Phase 4.1
      // notification taxonomy is `assigned` + `mention` only (SRS §5); status
      // changes are explicitly out of scope.

      return updated;
    });

    return updated;
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  @Span('work-items.delete')
  async deleteWorkItem(actor: JwtPayload, id: string): Promise<void> {
    const item = await this.getWorkItem(actor.workspaceId, id);
    // BA rule (P3.4): defects are never deleted — they are resolved by moving to
    // the 'closed' / 'closed_declined' defect state so the audit trail survives.
    if (item.type === 'defect') {
      throw new PreconditionFailedException(
        'DEFECT_DELETE_FORBIDDEN',
        'Defects cannot be deleted. Resolve the defect by setting its state to Closed or Closed Declined.',
      );
    }
    // An `assertTeamScoped` call sat here too, and is gone by the same ruling (2026-08-14).
    await this.assertProjectWritable(actor.workspaceId, item.projectId);
    await this.workItemRepo.softDelete(id, actor.workspaceId);
    // Remove this item's F6 relations so no dangling links survive the delete
    // (the relations table has no FK/cascade to work_items).
    await this.relationRepo.deleteForItem(id, actor.workspaceId);
    this.logger.log({ workItemId: id }, 'Work item soft-deleted');
  }

  // ── Notifications (F7) ──────────────────────────────────────────────────────
  // Producers enqueue in-app notifications for the item's watchers + assignee
  // (minus the actor). The Worker relay applies each recipient's preference and
  // handles delivery/SSE — this layer only fans out candidates.

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
   * The ONE place an assignment notification is produced — both the create and the update path
   * call this, because "assigned on create" and "assigned later" are the same event and had
   * already drifted into being two different products.
   *
   * Two rules are enforced here rather than at either call site, so a third write path cannot
   * lose one of them:
   *
   *   • the ACTOR is never notified of their own assignment. Self-assignment is the normal way
   *     someone picks up work, and a notification about a click you just made is noise.
   *   • FR-019 applies to an ASSIGNMENT, not only to a mention. The assignee is validated as an
   *     active WORKSPACE member (`assertAssignmentScope` → `assertWorkspaceMember`), never as
   *     someone who can SEE this project — so an item may legitimately be assigned to a colleague
   *     with No Access, and an unfiltered notification would name the item, its key and its title
   *     on the one surface §7 says must disclose nothing.
   *
   * Filtered rather than refused: assigning across an access boundary is a real thing an admin may
   * do deliberately (they may be about to grant access), and failing the whole write because of a
   * notification would be worse than not sending one. The assignment stands; the notification does
   * not.
   *
   * The event component of the idempotency key is `assignmentEventStamp(item)` — see its docblock
   * for why the row's post-write `updatedAt` and nothing else. Passing `item.assigneeId` here (the
   * old value) named the RECIPIENT twice and suppressed every re-assignment forever (FR-021).
   */
  private async notifyAssignee(actor: JwtPayload, item: WorkItem, tx: DbExecutor): Promise<void> {
    if (!item.assigneeId) return;
    const notifiable = await this.filterByProjectAccess(
      item.workspaceId,
      item.projectId,
      item.assigneeId === actor.sub ? [] : [item.assigneeId],
    );
    if (notifiable.length === 0) return;
    await this.emitWorkItemNotification(
      'WORK_ITEM_ASSIGNED',
      item,
      actor.sub,
      notifiable,
      { itemKey: item.itemKey, itemTitle: item.title, projectId: item.projectId },
      assignmentEventStamp(item),
      tx,
    );
  }

  /**
   * Pass `tx` when called from inside an open business transaction (e.g. the
   * update path) so the outbox insert commits/rolls back atomically with the
   * business write — no ghost notification, no silent drop on a post-commit
   * crash. Callers outside a transaction (e.g. comment notifications) may
   * omit it; the scheduler falls back to its own best-effort transaction.
   *
   * `eventId` is the caller's identifier for THE EVENT and it carries the whole weight of
   * `P4-NOTIF-FR-021` ("idempotent for the same event-recipient pair"): `template`, `item.id` and
   * `recipientId` are already in the key, so anything that merely restates one of those three
   * reduces the key to (template, item, user) and — the outbox key being UNIQUE under
   * `onConflictDoNothing`, and its copy in `in_app_notifications.source_event_id` UNIQUE too —
   * suppresses every subsequent event of that kind PERMANENTLY. Both callers got this wrong once:
   * assignments passed the assignee (= the recipient), mentions passed the work item id (= `item.id`).
   *
   * So an `eventId` must be (a) DIFFERENT for two different events and (b) IDENTICAL for a retry of
   * one — never `Date.now()` or a fresh uuid, which satisfy (a) by breaking (b) and would make the
   * relay re-send on every redelivery. `assignmentEventStamp` (the row's post-write `updatedAt`) and
   * a comment's own id are the two values that hold both halves.
   */
  private async emitWorkItemNotification<K extends NotificationTemplateName>(
    template: K,
    item: WorkItem,
    actorId: string,
    recipientIds: string[],
    vars: NotificationTemplateVars[K],
    eventId: string,
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
              idempotencyKey: stableEventId(`${template}:${item.id}:${recipientId}:${eventId}`),
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
   *
   * `commentId` is REQUIRED, and it is the mention notification's event identity (FR-021). This used
   * to pass `workItemId` as the key's discriminator — which is already `item.id` in the key — so the
   * key was (template, item, user) and the UNIQUE outbox key silently swallowed every mention after
   * the first: @-mention someone in Note #1 and again in Note #5 and only Note #1 ever notified,
   * for the life of the item. A comment id is different per Note and stable across a re-run of the
   * same Note's fan-out, which is exactly the two properties FR-021 asks for. Required rather than
   * optional on purpose: a defaulted `undefined` here would re-create the collapse in silence.
   */
  async notifyCommentAdded(
    actor: JwtPayload,
    workItemId: string,
    commentId: string,
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

    // Only @-mentions notify. A generic comment with no mention must NOT create
    // any notification (SRS FR-018; the taxonomy is `assigned` + `mention` only).
    if (mentioned.length > 0) {
      await this.emitWorkItemNotification(
        'WORK_ITEM_MENTIONED',
        item,
        actor.sub,
        mentioned,
        vars,
        // The NOTE, not the item — see this method's docblock and FR-021.
        commentId,
      );
    }
  }

  // ── Relations (F6 — work-item linking) ──────────────────────────────────────

  @Span('work-items.list-relations')
  async listRelations(actor: JwtPayload, id: string): Promise<WorkItemRelationView[]> {
    // Authorize a read on the item's own project (project isolation).
    await this.getWorkItem(actor.workspaceId, id);
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
    const sourceItem = await this.getWorkItem(actor.workspaceId, sourceId);
    /**
     * The SOURCE's project only — the relation row belongs to the item that owns it.
     *
     * Cross-project links are legal (see the target check below), so the target may well sit in an
     * archived project. Refusing on that would make an archived project able to block edits in
     * projects that are still live, which is not what "read-only" means (PRJ-FR-010).
     */
    await this.assertProjectWritable(actor.workspaceId, sourceItem.projectId);

    if (sourceId === targetId) {
      throw new PreconditionFailedException(
        'WORK_ITEM_RELATION_SELF',
        'A work item cannot be linked to itself',
      );
    }

    // Target must exist AND the actor must be allowed to view it. Cross-project
    // links are allowed, but only to items the actor can already see — otherwise
    // linking would leak a target's key/title/type/state via GET :id/relations.
    await this.getWorkItemForView(actor, targetId);

    if (await this.relationRepo.exists(sourceId, targetId, relationType, actor.workspaceId)) {
      throw new PreconditionFailedException(
        'WORK_ITEM_RELATION_EXISTS',
        'This relation already exists',
      );
    }

    // Reject the same relation in the REVERSE direction too (target → source):
    // for symmetric types (relates_to) it is a duplicate, for directional ones
    // (blocks / depends_on / duplicates) it is a contradiction. The unique index
    // only guards the exact source→target→type triple, so check the mirror here.
    if (await this.relationRepo.exists(targetId, sourceId, relationType, actor.workspaceId)) {
      throw new PreconditionFailedException(
        'WORK_ITEM_RELATION_EXISTS',
        'This relation already exists in the opposite direction',
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

    /**
     * The link and its history are ONE write.
     *
     * This was a bare `create` followed by a `void`-ed best-effort append: the row landed and the
     * `work_item.relation_added` entry was fire-and-forget outside any transaction, so a failed
     * append left a relation with no trace of who added it or when — on the surface (Revision
     * History) whose entire purpose is to answer that. Every other activity write in this service
     * takes the transaction handle; these two were the exceptions.
     */
    const source = await this.getWorkItem(actor.workspaceId, sourceId);
    await this.uow.run(async (tx) => {
      await this.relationRepo.create(
        { sourceItemId: sourceId, targetItemId: targetId, relationType, createdBy: actor.sub },
        actor.workspaceId,
        tx,
      );
      await this.appendActivity(
        tx,
        source,
        'work_item',
        actor.sub,
        'work_item.relation_added',
        null,
        { relationType, targetId },
      );
    });

    return this.relationRepo.listForItem(sourceId, actor.workspaceId);
  }

  @Span('work-items.unlink')
  async unlinkWorkItem(actor: JwtPayload, sourceId: string, relationId: string): Promise<void> {
    const sourceItem = await this.getWorkItem(actor.workspaceId, sourceId);
    // Same scope as `linkWorkItem` — the source's project owns the relation row.
    await this.assertProjectWritable(actor.workspaceId, sourceItem.projectId);
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
    // Unlink + history in one transaction, for the reason given in `linkWorkItem`.
    const source = await this.getWorkItem(actor.workspaceId, sourceId);
    await this.uow.run(async (tx) => {
      await this.relationRepo.delete(relationId, actor.workspaceId, tx);
      await this.appendActivity(
        tx,
        source,
        'work_item',
        actor.sub,
        'work_item.relation_removed',
        null,
        { relationType: relation.relationType, relationId },
      );
    });
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
    // Authorize edit on every project the batch touches (usually one backlog), and refuse the
    // whole reorder if any of them is archived (PRJ-FR-010). All-or-nothing, like the permission
    // check above and like the transaction below: a partially applied reorder is a corrupted order.
    for (const projectId of new Set(existing.map((w) => w.projectId))) {
      await this.accessService.assertProjectPermission(actor, projectId, PERMISSION.WORK_ITEM_EDIT);
      await this.assertProjectWritable(actor.workspaceId, projectId);
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
    const item = await this.getWorkItem(actor.workspaceId, id);
    if (item.projectId !== opts.projectId) {
      throw new PreconditionFailedException(
        'WORK_ITEM_PARENT_SCOPE_MISMATCH',
        'Work item does not belong to the given project',
      );
    }
    // Rank is backlog order, which is project content (PRJ-FR-010). Checked after the scope
    // mismatch above so the item's OWN project is the one guarded, not the caller's claim.
    await this.assertProjectWritable(actor.workspaceId, item.projectId);

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
    // Before the project scope check, and for a CLEAR as well as an assign — see
    // `assertMayAssignRelease`.
    await this.assertMayAssignRelease(actor, projectId);
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

    // Every iteration this batch touches: the ones the items are LEAVING and the one they are joining.
    // Bulk-assigning accepted work into a committed iteration satisfies the auto-accept rule just as a
    // status change does, and this path never checked it at all.
    const affectedIterations = new Set(
      [...items.map((i) => i.iterationId), iterationId].filter(
        (id): id is string => typeof id === 'string',
      ),
    );

    await this.uow.run(async (tx) => {
      await this.workItemRepo.assignIteration(
        items.map((i) => i.id),
        iterationId,
        actor.workspaceId,
        actor.sub,
        tx,
      );
      for (const affected of affectedIterations) {
        const flipped = await this.workItemRepo.autoAcceptIterationIfComplete(
          affected,
          actor.workspaceId,
          tx,
        );
        if (flipped) {
          this.logger.log(
            { iterationId: affected },
            'Iteration auto-accepted after bulk assignment',
          );
        }
      }
    });
    this.logger.log({ projectId, count: items.length, iterationId }, 'Bulk iteration assigned');
    return items.length;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Load and validate a set of item ids for a bulk operation: all must exist,
   * be non-deleted, and belong to the given workspace/project. Fails the whole
   * request (all-or-nothing) if any id is missing or out of scope.
   *
   * Both callers are WRITES (`bulkAssignRelease`, `bulkAssignIteration`) and both reach the
   * archived-project rule through here rather than each stating it, for the same reason
   * `CapacityPlansService` puts it in `requireDraft`: a bulk path added later is guarded by
   * construction. Every item is proven to be in `projectId` below, so one check covers the batch.
   */
  private async loadBulkItems(
    actor: JwtPayload,
    projectId: string,
    itemIds: string[],
  ): Promise<WorkItem[]> {
    // Authorization (work_item:edit on projectId) is enforced by the PolicyGuard
    // on the bulk routes; here we only validate the selection is in-scope.
    await this.assertProjectWritable(actor.workspaceId, projectId);
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
  /**
   * A Story/Defect may link to exactly one active FEATURE.
   *
   * Three refusals, each for a different reason:
   *   • a TASK carries no portfolio link — its Work Product does, and letting a Task hold one
   *     would double-count it in every rollup that walks `feature_id`;
   *   • an EPIC is not a link target. Rally attaches the story hierarchy to the LOWEST portfolio
   *     level only, and our rollup counts an Epic's children through its Features — a story
   *     pointed straight at an Epic would be counted by the Epic and by nothing else;
   *   • an ARCHIVED Feature is hidden from every portfolio surface, so work linked to it would
   *     roll up into a row nobody can see.
   *
   * The Feature does NOT have to be in the same project. Rally lets a team project's Story roll up
   * to a portfolio project's Feature, and `rollupSubqueries` matches on `feature_id` alone; the
   * project+release filter is Rally's CAPACITY rule, not its portfolio rule.
   */
  private async assertFeatureLinkable(
    workspaceId: string,
    itemType: WorkItemType,
    featureId: string,
  ): Promise<void> {
    if (itemType === 'task') {
      throw new PreconditionFailedException(
        'WORK_ITEM_FEATURE_LINK_NOT_ALLOWED',
        'A task inherits its Feature from its work product',
      );
    }
    const target = await this.workItemRepo.findPortfolioItemLinkTarget(featureId, workspaceId);
    if (!target) {
      throw new NotFoundException('PORTFOLIO_ITEM_NOT_FOUND', 'Portfolio item not found');
    }
    if (target.type !== 'feature') {
      throw new PreconditionFailedException(
        'WORK_ITEM_FEATURE_LINK_NOT_FEATURE',
        'Work items link to a Feature; an Epic rolls up through its Features',
      );
    }
    if (target.archived) {
      throw new PreconditionFailedException(
        'WORK_ITEM_FEATURE_LINK_ARCHIVED',
        'That Feature is archived',
      );
    }
  }

  /**
   * Assigning — or clearing — a Release is an ADMIN action, per BL §8:294: "Editor may manage
   * US/DE/Task only in explicitly assigned Teams and **cannot assign Release**."
   *
   * The route can't express this: `PATCH /work-items/:id` and `PATCH /work-items/bulk-release` are
   * gated on `work_item:edit`, which an Editor legitimately holds for every other field in the same
   * body. So the rule is a FIELD-level check, and it lives here in one place rather than at each of the
   * three call sites that can move a release.
   *
   * **This was failing closed BY ACCIDENT until now**, and that is why it is being added at this moment
   * rather than earlier: `GET /releases` required `release:view`, which an Editor does not hold, so the
   * release picker resolved to `[]` and the UI could not produce a `releaseId` to send. Splitting off
   * `GET /releases/options` (a reference feed an Editor CAN read, so a released item stops rendering as
   * unscheduled) removed that accident and made the write reachable. A fix that turns a latent
   * over-permissive write into a live one has to close it in the same change.
   *
   * `release:view` is the code, not a new one: the authority to schedule work into a release is the
   * authority to see releases at all, and `ACCESS_LEVEL_PERMISSIONS` already gives it to `admin` and
   * withholds it from `editor` — which is exactly §294's line. Clearing is gated too: §294 says an
   * Editor does not decide release membership, and removing an item from a release decides it just as
   * much as adding one.
   */
  private async assertMayAssignRelease(actor: JwtPayload, projectId: string): Promise<void> {
    await this.accessService.assertProjectPermission(actor, projectId, PERMISSION.RELEASE_VIEW);
  }

  private async assertReleaseAssignable(
    workspaceId: string,
    projectId: string,
    releaseId: string,
  ): Promise<void> {
    const release = await this.workItemRepo.findReleaseAssignability(releaseId, workspaceId);
    if (!release) {
      throw new NotFoundException('RELEASE_NOT_FOUND', 'Release not found');
    }
    if (release.projectId !== projectId) {
      throw new PreconditionFailedException(
        'RELEASE_PROJECT_MISMATCH',
        'Release must belong to the same project as the work item',
      );
    }
    /**
     * "You cannot add work items to an accepted release" — the ONE lifecycle consequence Rally
     * documents for a release state
     * (`techdocs.broadcom.com/.../working-with-releases/`, and the release research file records it as
     * the only documented behavioural effect of `State`).
     *
     * This rule REPLACES an invented transition graph. `ReleasesService` used to enforce
     * `planning → active → accepted` and refuse `planning → accepted`, which Rally does not do for any
     * artifact state — Broadcom's own troubleshooting KB tells users to move an `Accepted` release
     * BACK to Planning or Committed, so the graph blocked the remedy Rally prescribes. Worse, both
     * release pickers offer all three states, so the refusal was a guaranteed error on a value the
     * product itself offered.
     *
     * Scoped to ADDING: this is reached only when an assignment is being made, so an item already in
     * an accepted release stays editable and can still be moved OUT. Refusing that too would strand
     * work in a closed release, which is the mirror of the defect above.
     */
    if (release.status === 'accepted') {
      throw new PreconditionFailedException(
        'RELEASE_ACCEPTED_NO_NEW_WORK',
        'An accepted release does not take new work items',
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
   *   - owner (`assigneeId`) → must be offered by the OWNER PICKER for the effective team
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
      /**
       * The OWNER the item will have, when the owner OR the team is moving — separate from
       * `memberIds` because it is judged against a NARROWER population than "active workspace
       * member", and because `null` is meaningful here (it is the only value a team-less item may
       * hold). `undefined` means "neither fact moved, do not re-judge".
       */
      assigneeId?: string | null;
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
    if (scope.assigneeId !== undefined) {
      await this.assertOwnerInTeam(
        workspaceId,
        scope.projectId,
        scope.teamId ?? null,
        scope.assigneeId,
      );
    }
  }

  /**
   * OWNER ⊆ the selected TEAM's active roster, and NO team means NO owner.
   *
   * "A named Owner must be an active member of the selected Team; if `teamId` is null, `assigneeId`
   * must also be null/Unassigned" (`Phase 1/03_Work_Item_Detail/SRS.md` §7:125). The same sentence
   * appears in `Phase 1/04:84` (a Task's owner against its inherited parent Team), `Phase 2/01:303`
   * + AC-16:336 and `Phase 2/03:435`. Before this, the whole rule was enforced by the SPA's picker
   * FEED alone — `assertAssignmentScope` asked only `assertWorkspaceMember`, so
   * `POST /v1/work-items` with `{ teamId: null, assigneeId: <anyone in the workspace> }` was
   * accepted. `Phase 1/01_Project_Management/SRS.md:146` is the BA's own answer to that: "API must
   * enforce project/team access; UI hide không đủ".
   *
   * The population is `ProjectsService.listProjectMemberOptions(ws, project, team)` — deliberately
   * the SAME query `GET /projects/:id/member-options?teamId=` serves the picker, not a
   * reimplementation of it. `projectTeamContext`'s docblock states the principle: a server that
   * counted a different population than the picker offers would refuse a person the user was just
   * invited to choose. It costs one extra consequence, recorded because it is a real behaviour
   * change: that feed excludes Workspace Admins, which is AC-16's "Workspace Admin không phải
   * delivery owner hợp lệ", so a WA can no longer be set as an Owner through the API either. That
   * exclusion is flagged as a DECLARED CONFLICT in the feed's own docblock; if the BA rules the
   * other way, the fix is that one filter and this method follows for free.
   *
   * Only reached when the owner or the team is actually MOVING (see the two call sites) — the same
   * restraint `assertIterationAssignable` uses for the team/iteration pair. Re-judging on every
   * unrelated patch would start refusing a title edit on an item whose owner and team already
   * disagree, which is real existing data and not that patch's fault.
   */
  private async assertOwnerInTeam(
    workspaceId: string,
    projectId: string,
    teamId: string | null,
    assigneeId: string | null,
  ): Promise<void> {
    if (!assigneeId) return;
    if (!teamId) {
      throw new PreconditionFailedException(
        'ASSIGNEE_REQUIRES_TEAM',
        'An item with no Team must be Unassigned. Set a Team before naming an Owner.',
      );
    }
    const options = await this.projectsService.listProjectMemberOptions(
      workspaceId,
      projectId,
      teamId,
    );
    if (!options.some((o) => o.userId === assigneeId)) {
      throw new PreconditionFailedException(
        'ASSIGNEE_NOT_TEAM_MEMBER',
        'The Owner must be an active member of the selected Team',
      );
    }
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  async getWorkItemLabels(
    actor: JwtPayload,
    id: string,
  ): Promise<Array<{ id: string; name: string; color: string }>> {
    await this.getWorkItem(actor.workspaceId, id);
    return this.workItemRepo.listLabels(id);
  }

  async addLabelToWorkItem(actor: JwtPayload, id: string, labelId: string): Promise<void> {
    const item = await this.getWorkItem(actor.workspaceId, id);
    // The label CATALOGUE is already guarded on an archived project
    // (`ProjectsService.createLabel`); the ASSIGNMENT was not, so labels could not be created on an
    // archived project but could still be applied and removed.
    await this.assertProjectWritable(actor.workspaceId, item.projectId);
    // P1-15: label must belong to the same project as the work item
    await this.projectsService.assertLabelBelongsToProject(item.projectId, labelId);
    await this.workItemRepo.addLabel(id, labelId, actor.workspaceId);
  }

  async removeLabelFromWorkItem(actor: JwtPayload, id: string, labelId: string): Promise<void> {
    const item = await this.getWorkItem(actor.workspaceId, id);
    await this.assertProjectWritable(actor.workspaceId, item.projectId);
    await this.workItemRepo.removeLabel(id, labelId, actor.workspaceId);
  }

  // ── Milestones ──────────────────────────────────────────────────────────────

  async getWorkItemMilestones(
    actor: JwtPayload,
    id: string,
  ): Promise<Array<{ id: string; name: string }>> {
    await this.getWorkItem(actor.workspaceId, id);
    return this.workItemRepo.listMilestones(id);
  }

  /**
   * Replace-set of the milestones assigned to a work item.
   *
   * The TWIN write is `PUT /milestones/:id/artifacts`, and it writes the same `milestone_artifacts`
   * rows from the other end. It enforced three conditions; this one enforced a weaker version of
   * the first and neither of the other two — so a Task could become a Milestone artifact, and any
   * item could join a Team-scoped Milestone, purely by choosing this endpoint. The rule now has one
   * home (`assertArtifactsInMilestoneScope`, reached through `MilestonesService`), so the two
   * endpoints cannot answer differently again.
   */
  async setWorkItemMilestones(
    actor: JwtPayload,
    id: string,
    milestoneIds: string[],
  ): Promise<Array<{ id: string; name: string }>> {
    const item = await this.getWorkItem(actor.workspaceId, id);
    // The ITEM's project. The MILESTONE's project is checked by `assertArtifactsAssignable` — the
    // two can differ, because a milestone's scope spans `milestone_projects`, and one row written
    // from this end touches both.
    await this.assertProjectWritable(actor.workspaceId, item.projectId);
    /**
     * The MILESTONE half of `Phase 4/02_Roles_Permissions/SRS.md:80`, whose Release half is
     * `assertMayAssignRelease` above — one matrix row, one verdict, `Hidden` for an Editor. Before
     * the route's `work_item:edit` gate was the only check here, so an Editor decided milestone
     * membership from this end while the same row's Release field refused them, and while every
     * `PUT /milestones/:id/artifacts` writing the identical row refused them too.
     *
     * UNCONDITIONAL, ahead of the scope check and before an empty set short-circuits it: a CLEAR is
     * a membership decision (§138 refuses Editor "mutation", not Editor additions), and the rule is
     * about the CALLER, so it must not depend on the payload resolving. See
     * `MilestonesService.assertMayAssignMilestones` for why the code is `milestone:view`.
     */
    await this.milestonesService.assertMayAssignMilestones(actor, item.projectId);
    const uniqueIds = [...new Set(milestoneIds)];
    if (uniqueIds.length > 0) {
      await this.milestonesService.assertArtifactsAssignable(actor.workspaceId, uniqueIds, [item]);
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
    await this.getWorkItem(actor.workspaceId, workItemId);
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
    const item = await this.getWorkItem(actor.workspaceId, workItemId);
    /**
     * Logged hours are project content, so all three time-log writes are guarded (PRJ-FR-010).
     *
     * Worth stating because "I did this work, let me record it" reads like it should survive an
     * archive: it does not, because Actual hours feed Team Status, Team Capacity and the Iteration
     * Status totals, and a project someone is still booking time against has not been archived. The
     * remedy is to restore the project, which is one action.
     */
    await this.assertProjectWritable(actor.workspaceId, item.projectId);
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
    const item = await this.getWorkItem(actor.workspaceId, workItemId);
    await this.assertProjectWritable(actor.workspaceId, item.projectId);
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
    const item = await this.getWorkItem(actor.workspaceId, workItemId);
    await this.assertProjectWritable(actor.workspaceId, item.projectId);
    const log = await this.timeLogRepo.findById(logId, actor.workspaceId);
    if (!log || log.workItemId !== workItemId) {
      throw new NotFoundException('TIME_LOG_NOT_FOUND', 'Time log entry not found');
    }
    // Workspace admins can retract any log; regular users only their own.
    const isAdmin = permissionGrants(
      await this.accessService.getWorkspacePermissions(actor.sub, actor.workspaceId),
      PERMISSION.WORKSPACE_EDIT,
    );
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
  //
  // `watch` and `unwatch` are deliberately NOT guarded by `assertProjectWritable`.
  //
  // A watcher row is the READER'S OWN subscription, not the project's content — the same
  // judgement `ProjectsService` already made for its three member writes ("access is not the
  // project's content"), and for the same decisive reason: the withdrawal has to keep working.
  // A user who cannot unwatch an archived project's items is stuck receiving its notifications
  // with no way to stop, and nothing about being archived makes that acceptable. `watch` stays
  // open with it, because guarding one half and not the other is a trap: `logTime`'s auto-watch
  // aside, a person who wants to follow an item until the project is restored is asking for
  // nothing the project can be harmed by.

  @Span('work-items.list-watchers')
  async listWatchers(actor: JwtPayload, workItemId: string): Promise<Watcher[]> {
    await this.getWorkItem(actor.workspaceId, workItemId);
    return this.watcherRepo.listByWorkItem(workItemId, actor.workspaceId);
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
  //
  // Thin delegations to `EntityAttachmentsService`. The mechanics — quota, presign,
  // confirm, the reaper contract, the delete-owner rule — are identical for every entity
  // that can own files and moved to `@modules/attachments` with migration 0083. What stays
  // here is what is genuinely work-item-specific: proving the item exists, which also
  // resolves the `projectId` the activity log needs.
  //
  // Route authorization is unchanged: `WorkItemsController` still gates these on
  // `work_item:edit` / `work_item:view` for the path item's project.
  //
  // The file id is the public attachment id. Callers never see the link row.

  private static attachmentRef(workItemId: string): AttachmentRef {
    return { entityType: 'work_item', entityId: workItemId };
  }

  @Span('work-items.presign-attachment')
  async presignAttachment(
    actor: JwtPayload,
    workItemId: string,
    input: { filename: string; mimeType: string; sizeBytes: number; checksumSha256: string },
  ): Promise<{ attachmentId: string; uploadUrl: string; requiredHeaders: Record<string, string> }> {
    const item = await this.getWorkItem(actor.workspaceId, workItemId);
    /**
     * Refused at PRESIGN, not only at confirm.
     *
     * Presign reserves a `storage.files` row and hands out a signed PUT, so letting it through and
     * refusing the confirm would put bytes in the bucket for a project that accepts no content and
     * leave the row to the reaper. Guarded here rather than inside `EntityAttachmentsService`
     * because that service states its own rule — it "never loads a work item or a portfolio item"
     * and takes its `projectId` from the caller — and an `entityType → project` lookup in there is
     * exactly the owner-type registry its docblock refuses.
     */
    await this.assertProjectWritable(actor.workspaceId, item.projectId);
    return this.entityAttachments.presign(actor, WorkItemsService.attachmentRef(workItemId), input);
  }

  @Span('work-items.confirm-attachment')
  async confirmAttachment(
    actor: JwtPayload,
    workItemId: string,
    attachmentId: string,
  ): Promise<EntityAttachment> {
    const item = await this.getWorkItem(actor.workspaceId, workItemId);
    // Checked again at confirm: presign and confirm are two requests, and a project archived
    // between them must not gain a visible attachment. Same reason the quota is re-checked there.
    await this.assertProjectWritable(actor.workspaceId, item.projectId);
    return this.entityAttachments.confirm(
      actor,
      WorkItemsService.attachmentRef(workItemId),
      attachmentId,
      item.projectId,
    );
  }

  @Span('work-items.list-attachments')
  async listAttachments(actor: JwtPayload, workItemId: string): Promise<EntityAttachment[]> {
    await this.getWorkItem(actor.workspaceId, workItemId);
    return this.entityAttachments.list(actor, WorkItemsService.attachmentRef(workItemId));
  }

  @Span('work-items.get-attachment-download-url')
  async getAttachmentDownloadUrl(
    actor: JwtPayload,
    workItemId: string,
    attachmentId: string,
  ): Promise<{ downloadUrl: string }> {
    await this.getWorkItem(actor.workspaceId, workItemId);
    return this.entityAttachments.downloadUrl(
      actor,
      WorkItemsService.attachmentRef(workItemId),
      attachmentId,
    );
  }

  @Span('work-items.delete-attachment')
  async deleteAttachment(
    actor: JwtPayload,
    workItemId: string,
    attachmentId: string,
  ): Promise<void> {
    const item = await this.getWorkItem(actor.workspaceId, workItemId);
    await this.assertProjectWritable(actor.workspaceId, item.projectId);
    await this.entityAttachments.delete(
      actor,
      WorkItemsService.attachmentRef(workItemId),
      attachmentId,
      item.projectId,
    );
  }
}

/**
 * Unblocking an item clears its Blocked Reason.
 *
 * Rally: "When a blocked status is removed, the Blocked Reason field is cleared"
 * (Broadcom TechDocs, Task Board app). A reason that outlives its block is not history — it
 * is a claim that the item is blocked for that reason, sitting next to a flag that says it is
 * not. The UI made this visible: the reason cell is only editable WHILE blocked, so a stale
 * reason could be read but never removed.
 *
 * Applied in the SERVICE rather than the DTO or the client, so every caller gets it — the
 * inline cell, the detail pane, and any future bulk path — and applied even when the same
 * patch also sends a reason: `isBlocked: false` wins, because the two cannot both be true.
 *
 * The old reason is not lost. `activity-diff.ts` tracks `isBlocked` and `blockedReason`, so
 * the transition and the text it replaced are both in the activity log.
 */
function clearReasonOnUnblock(input: UpdateWorkItemInput): { blockedReason?: null } {
  return input.isBlocked === false ? { blockedReason: null } : {};
}
