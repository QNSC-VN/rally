import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { and, asc, eq, isNull, sql, desc, inArray } from 'drizzle-orm';
import {
  InjectDrizzle,
  buildPageResult,
  keysetCondition,
  NotFoundException,
  PreconditionFailedException,
} from '@platform';
import type { JwtPayload, CursorPayload, PagedResult, DrizzleDB } from '@platform';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { PERMISSION } from '@shared-kernel';
import { capacityPlans, workItems, tasks } from '../../../../../db/schema/work';
import { acceptedScheduleStatesSql, type ReleaseStatus } from '../../../../../db/schema/enums';
import { IReleaseRepository, RELEASE_REPOSITORY } from '../domain/ports/release.repository';
import type { Release, UpdateReleaseInput } from '../domain/release.types';
import { ActivityLogger, type ActivityLog } from '@modules/activity';
import { RELEASE_ACTIVITY_CONFIG } from './release-activity-diff';

/** Walk an error's `.cause` chain looking for a PG unique-violation (code 23505). */
function isDuplicateKeyError(err: unknown): boolean {
  let current: unknown = err;
  while (true) {
    if (current && typeof current === 'object' && 'code' in current) {
      if ((current as Record<string, unknown>).code === '23505') return true;
    }
    if (current && typeof current === 'object' && 'cause' in current) {
      current = current.cause;
    } else {
      return false;
    }
  }
}

/** Valid release status transitions (Rally-aligned lifecycle). */
const RELEASE_TRANSITIONS: Record<ReleaseStatus, ReleaseStatus[]> = {
  planning: ['active', 'planning'],
  active: ['accepted', 'planning', 'active'],
  accepted: ['active', 'accepted'],
};

/**
 * A release's right-panel roll-up, exactly as P3-REL-FR-018 fixes it: `Task Roll-up` and
 * `Accepted`, nothing else.
 *
 * Task Roll-up is Estimate / To Do / Actual **HOURS** from the tasks under the release's
 * assigned Story/Defect items (P3-REL-FR-023), not an item or point count. `acceptedItems` is
 * FR-024's "accepted work total for the Release".
 *
 * There is deliberately NO percentage, no point total and no done/remaining count here.
 * P3-REL-FR-037: "Phase 3 Release list/detail must not add a Release Progress column/widget;
 * progress/tracking belongs to `Portfolio > Release Tracking`", and §7.5 defers the progress
 * percentage, its zero-state, its formula and its recalculation out of Phase 3.2 entirely.
 * A field on this object is a field a Phase 3 surface can render, which is why the numbers are
 * not merely hidden in the SPA — they are not computed or served at all.
 */
export interface TaskRollup {
  estimateHours: number;
  toDoHours: number;
  actualHours: number;
  acceptedItems: number;
}

/** A release with no linked Story/Defect at all: zeroes, not absent values. */
const EMPTY_TASK_ROLLUP: TaskRollup = {
  estimateHours: 0,
  toDoHours: 0,
  actualHours: 0,
  acceptedItems: 0,
};

@Injectable()
export class ReleasesService {
  private readonly logger = new Logger(ReleasesService.name);

  constructor(
    @Inject(RELEASE_REPOSITORY) private readonly releaseRepo: IReleaseRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
    private readonly activity: ActivityLogger,
  ) {}

  // ── Revision History (activity log) ─────────────────────────────────────────

  /** Newest-first revision history for one release (workspace-view gated). */
  async getReleaseActivity(
    actor: JwtPayload,
    id: string,
    args: { limit: number; offset: number },
  ): Promise<{ items: ActivityLog[]; total: number }> {
    await this.getReleaseForView(actor, id);
    const page = Math.floor(args.offset / args.limit) + 1;
    const res = await this.activity.listFor(id, actor.workspaceId, page, args.limit);
    return { items: res.data, total: res.total };
  }

  private releaseSubject(r: Release) {
    return {
      workspaceId: r.workspaceId,
      projectId: r.projectId,
      entityType: 'release' as const,
      entityId: r.id,
    };
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async listReleases(
    actor: JwtPayload,
    projectId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Release & { taskEstimate: number }>> {
    await this.projectsService.getProject(actor.workspaceId, projectId);
    const page = await this.releaseRepo.listByProject(projectId, actor.workspaceId, args);
    const ids = page.data.map((r) => r.id);
    // Batched over the whole page. `taskRollup` used to be built only in the detail path, so
    // every list consumer saw `undefined` and read `?? 0` off it. The list's own `taskEstimate`
    // column (FR-004) is the roll-up's Estimate hours — one number, computed once, so the
    // column and the detail panel cannot disagree.
    const rollups = await this.computeTaskRollups(ids);
    return {
      ...page,
      data: page.data.map((r) => {
        const taskRollup = rollups.get(r.id) ?? EMPTY_TASK_ROLLUP;
        return { ...r, taskEstimate: taskRollup.estimateHours, taskRollup };
      }),
    };
  }

  /**
   * The right panel's roll-up per release (FR-018), batched over a page.
   *
   * Two questions with two different populations, so two grouped queries:
   *  - Task Roll-up hours come from `work.tasks` through the parent Story/Defect (FR-023);
   *  - `Accepted` counts the release's own Story/Defect items (FR-024).
   *
   * A release absent from the map has nothing assigned and resolves to `EMPTY_TASK_ROLLUP`.
   */
  private async computeTaskRollups(releaseIds: string[]): Promise<Map<string, TaskRollup>> {
    if (releaseIds.length === 0) return new Map();
    const [hours, accepted] = await Promise.all([
      this.computeTaskHours(releaseIds),
      this.computeAcceptedCounts(releaseIds),
    ]);
    const map = new Map<string, TaskRollup>();
    for (const id of new Set([...hours.keys(), ...accepted.keys()])) {
      map.set(id, {
        ...(hours.get(id) ?? { estimateHours: 0, toDoHours: 0, actualHours: 0 }),
        acceptedItems: accepted.get(id) ?? 0,
      });
    }
    return map;
  }

  /**
   * SRS FR-023 / §6.1 FR-004 — Estimate, To Do and Actual hours summed from the child tasks of
   * the stories/defects assigned to each release. Three independent fields (they never derive
   * from each other), summed the same way Team Status and the Phase 6 projection sum them, so
   * every surface reports the same hours. The Estimate column on the list is this Estimate.
   *
   * `innerJoin` on the parent WITH `parent.deleted_at IS NULL`: a soft-deleted Story does not
   * cascade to `work.tasks` (the FK is `ON DELETE cascade`, which a soft delete never fires),
   * so an orphaned task would otherwise keep charging hours to the release. No team predicate —
   * a release is not team-scoped, and this panel is the release's own total.
   */
  private async computeTaskHours(
    releaseIds: string[],
  ): Promise<Map<string, Omit<TaskRollup, 'acceptedItems'>>> {
    const rows = await this.db
      .select({
        releaseId: workItems.releaseId,
        estimateHours: sql<number>`COALESCE(SUM(${tasks.estimateHours}), 0)`,
        toDoHours: sql<number>`COALESCE(SUM(${tasks.todoHours}), 0)`,
        actualHours: sql<number>`COALESCE(SUM(${tasks.actualHours}), 0)`,
      })
      .from(tasks)
      .innerJoin(workItems, eq(tasks.parentId, workItems.id))
      .where(
        and(
          inArray(workItems.releaseId, releaseIds),
          isNull(workItems.deletedAt),
          isNull(tasks.deletedAt),
        ),
      )
      .groupBy(workItems.releaseId);
    const map = new Map<string, Omit<TaskRollup, 'acceptedItems'>>();
    for (const r of rows) {
      if (!r.releaseId) continue;
      map.set(r.releaseId, {
        estimateHours: Number(r.estimateHours),
        toDoHours: Number(r.toDoHours),
        actualHours: Number(r.actualHours),
      });
    }
    return map;
  }

  /** FR-024 — the accepted work total: the release's Story/Defect items in an accepted state. */
  private async computeAcceptedCounts(releaseIds: string[]): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        releaseId: workItems.releaseId,
        acceptedItems: sql<number>`COUNT(*) FILTER (WHERE ${workItems.scheduleState} IN (${acceptedScheduleStatesSql()}))::int`,
      })
      .from(workItems)
      .where(
        and(
          inArray(workItems.releaseId, releaseIds),
          isNull(workItems.deletedAt),
          sql`${workItems.type} IN ('story', 'defect')`,
        ),
      )
      .groupBy(workItems.releaseId);
    const map = new Map<string, number>();
    for (const r of rows) if (r.releaseId) map.set(r.releaseId, Number(r.acceptedItems));
    return map;
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createRelease(
    actor: JwtPayload,
    projectId: string,
    name: string,
    opts: {
      description?: string;
      theme?: string;
      startDate?: string;
      releaseDate?: string;
      state?: string;
      releaseNotes?: string;
    } = {},
  ): Promise<Release> {
    await this.projectsService.assertProjectWritable(actor.workspaceId, projectId);

    // Validate date range: releaseDate >= startDate
    if (opts.startDate && opts.releaseDate && opts.releaseDate < opts.startDate) {
      throw new PreconditionFailedException(
        'RELEASE_INVALID_DATE_RANGE',
        'Release date must be >= start date',
      );
    }

    // releaseKey reservation reads MAX(existing) + 1 (not atomic under
    // concurrent creates) and releases can be deleted, so a collision on
    // uq_releases_key is possible; retry once with a freshly computed key.
    const MAX_KEY_RETRIES = 2;
    let release: Release | undefined;
    let lastErr: unknown;

    for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt++) {
      const keyNumber = await this.releaseRepo.nextKeyNumber(projectId, actor.workspaceId);
      try {
        release = await this.releaseRepo.create({
          id: uuidv7(),
          workspaceId: actor.workspaceId,
          projectId,
          releaseKey: `RE-${keyNumber}`,
          name,
          description: opts.description,
          theme: opts.theme,
          startDate: opts.startDate,
          releaseDate: opts.releaseDate,
          status: (opts.state as Release['status']) ?? 'planning',
          releaseNotes: opts.releaseNotes,
        });
        break;
      } catch (err: unknown) {
        lastErr = err;
        if (isDuplicateKeyError(err) && attempt < MAX_KEY_RETRIES - 1) {
          this.logger.warn({ projectId, attempt: attempt + 1 }, 'Duplicate release key — retrying');
          continue;
        }
        throw err;
      }
    }

    if (!release) throw lastErr;

    this.logger.log({ releaseId: release.id, projectId, userId: actor.sub }, 'Release created');
    await this.activity.logSafe([
      this.activity.build(this.releaseSubject(release), actor.sub, 'release.created', null),
    ]);
    return release;
  }

  // ── Get ───────────────────────────────────────────────────────────────────

  async getRelease(workspaceId: string, id: string): Promise<Release> {
    const release = await this.releaseRepo.findById(id);
    if (!release || release.workspaceId !== workspaceId) {
      throw new NotFoundException('RELEASE_NOT_FOUND', 'Release not found');
    }
    return release;
  }

  /**
   * Load a release for a READ. Project-scoped `release:view` is enforced by the
   * PolicyGuard at the route (resource-resolved), so this just loads the row.
   */
  private async getReleaseForView(actor: JwtPayload, id: string): Promise<Release> {
    return this.getRelease(actor.workspaceId, id);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateRelease(actor: JwtPayload, id: string, input: UpdateReleaseInput): Promise<Release> {
    // Authorization (release:edit at this project) is enforced by the PolicyGuard.
    const release = await this.getRelease(actor.workspaceId, id);
    await this.projectsService.assertProjectWritable(actor.workspaceId, release.projectId);

    // Validate status transition
    if (input.status && input.status !== release.status) {
      const allowed = RELEASE_TRANSITIONS[release.status] ?? [];
      if (!allowed.includes(input.status)) {
        throw new PreconditionFailedException(
          'RELEASE_INVALID_TRANSITION',
          `Invalid release transition: ${release.status} → ${input.status}. Allowed: ${allowed.join(', ') || 'none (terminal)'}`,
        );
      }
      // Auto-set releasedAt when transitioning to accepted
      if (input.status === 'accepted' && !input.releasedAt) {
        input.releasedAt = new Date();
      }
    }

    // Validate date range: releaseDate >= startDate (using merged values)
    const startDate = input.startDate !== undefined ? input.startDate : release.startDate;
    const releaseDate = input.releaseDate !== undefined ? input.releaseDate : release.releaseDate;
    if (startDate && releaseDate && releaseDate < startDate) {
      throw new PreconditionFailedException(
        'RELEASE_INVALID_DATE_RANGE',
        'Release date must be >= start date',
      );
    }

    const updated = await this.releaseRepo.update(id, input);
    await this.activity.logSafe(
      this.activity.buildDiff(
        this.releaseSubject(updated),
        actor.sub,
        release as unknown as Record<string, unknown>,
        input as Record<string, unknown>,
        RELEASE_ACTIVITY_CONFIG,
        'release.updated',
      ),
    );
    return updated;
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteRelease(actor: JwtPayload, id: string): Promise<void> {
    // Authorization (release:delete at this project) is enforced by the PolicyGuard.
    const release = await this.getRelease(actor.workspaceId, id);
    await this.projectsService.assertProjectWritable(actor.workspaceId, release.projectId);
    // Accepted releases cannot be deleted
    if (release.status === 'accepted') {
      throw new PreconditionFailedException(
        'RELEASE_NOT_DELETABLE',
        'Accepted releases cannot be deleted',
      );
    }

    /**
     * A release that a capacity plan is built on cannot be deleted.
     *
     * Migration 0085 adds the foreign key that makes this true at the database level; this check is
     * what turns it into an answer a planner can act on. Deleting one used to succeed and leave the
     * plan pointing at a missing row: its Release badge went blank, and because the plan's release is
     * deliberately immutable while `releaseWindow` resolved to null, publish could never write the
     * Release field again and nothing could repair it.
     *
     * The plan is named in the message: "delete the plan first" is only actionable if you know which.
     */
    const plans = await this.db
      .select({ planKey: capacityPlans.planKey, name: capacityPlans.name })
      .from(capacityPlans)
      .where(eq(capacityPlans.releaseId, id))
      .limit(3);
    if (plans.length > 0) {
      const named = plans.map((p) => `${p.planKey} (${p.name})`).join(', ');
      throw new PreconditionFailedException(
        'RELEASE_HAS_CAPACITY_PLAN',
        `This release is planned by ${named} — delete the plan first`,
      );
    }

    /**
     * As with an iteration: `work_items.release_id` and `portfolio_items.release_id` carry
     * `ON DELETE SET NULL` (migration 0114), so the work is unscheduled in the same statement rather
     * than left pointing at a missing row. `work_items.found_in_release_id` already behaved this way.
     * The capacity-plan reference above is the one link that REFUSES instead, because a plan's release
     * is immutable and a null there is unrepairable.
     */
    await this.releaseRepo.delete(id);
    this.logger.log({ releaseId: id }, 'Release deleted; its work items are now unscheduled');
  }

  // ── Get Detail (includes task rollup) ─────────────────────────────────────

  async shipRelease(actor: JwtPayload, id: string): Promise<Release> {
    const release = await this.getRelease(actor.workspaceId, id);
    await this.projectsService.assertProjectWritable(actor.workspaceId, release.projectId);
    await this.accessService.assertProjectPermission(
      actor,
      release.projectId,
      PERMISSION.RELEASE_EDIT,
    );
    if (release.status === 'accepted') {
      throw new PreconditionFailedException(
        'RELEASE_ALREADY_SHIPPED',
        'Release has already shipped',
      );
    }
    const updated = await this.releaseRepo.update(id, {
      status: 'accepted',
      releasedAt: new Date(),
    });
    this.logger.log({ releaseId: id }, 'Release shipped');
    return updated;
  }
  async getReleaseDetail(actor: JwtPayload, id: string) {
    const release = await this.getReleaseForView(actor, id);

    const rollups = await this.computeTaskRollups([id]);
    const taskRollup = rollups.get(id) ?? EMPTY_TASK_ROLLUP;

    return {
      ...release,
      taskEstimate: taskRollup.estimateHours,
      taskRollup,
    };
  }

  // ── Release Artifacts (P3) ──────────────────────────────────────────

  /**
   * List work items (stories/defects) linked to a release.
   * Reuses the same shape as the backlog list.
   */
  async listReleaseArtifacts(
    actor: JwtPayload,
    releaseId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<
    PagedResult<{
      id: string;
      itemKey: string;
      type: string;
      title: string;
      scheduleState: string;
      priority: string;
      assigneeId: string | null;
      iterationId: string | null;
      releaseId: string | null;
      storyPoints: number | null;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    // Validates the release exists and the actor may view it (project-scoped).
    await this.getReleaseForView(actor, releaseId);

    const conditions = [
      eq(workItems.releaseId, releaseId),
      eq(workItems.workspaceId, actor.workspaceId),
      isNull(workItems.deletedAt),
      sql`type IN ('story', 'defect')`,
    ];

    // Total artifacts on this release (before cursor/limit) for the footer count.
    const baseConditions = [...conditions];

    if (args.cursor) {
      conditions.push(keysetCondition(workItems.createdAt, workItems.id, args.cursor));
    }

    const rows = await this.db
      .select({
        id: workItems.id,
        itemKey: workItems.itemKey,
        type: workItems.type,
        title: workItems.title,
        scheduleState: workItems.scheduleState,
        priority: workItems.priority,
        assigneeId: workItems.assigneeId,
        iterationId: workItems.iterationId,
        releaseId: workItems.releaseId,
        storyPoints: sql<number | null>`${workItems.storyPoints}::float8`,
        createdAt: workItems.createdAt,
        updatedAt: workItems.updatedAt,
      })
      .from(workItems)
      .where(and(...conditions))
      .orderBy(desc(workItems.createdAt), asc(workItems.id))
      .limit(args.limit + 1);

    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(workItems)
      .where(and(...baseConditions));

    return buildPageResult(
      rows,
      args.limit,
      (w) => [w.createdAt.toISOString()],
      'desc',
      Number(countRow?.total ?? 0),
    );
  }

  // The snapshot WRITER deliberately does not live here.
  //
  // `upsertReleaseSnapshot` used to sit at this spot and had no caller anywhere — the
  // daily cron only ever snapshotted iterations — so `release_daily_snapshots` was
  // empty in every environment and this read has always returned `[]`. It also counted
  // `Completed` as done (COMPLETED_SCHEDULE_STATES), which is the wrong population for
  // Release Tracking: RT-AC-08 admits {Accepted, Release} only.
  //
  // Phase 6 makes the burnup a per-(release, team scope, day) series that also carries
  // the top-down Preliminary Feature estimate, so writing it needs the portfolio
  // classification and the workspace's preliminary-estimate map. That belongs to the
  // reporting module, which owns those rules; a second writer here would be the drift
  // the single-source-of-truth convention exists to prevent.
}
