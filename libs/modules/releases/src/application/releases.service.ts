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
import {
  capacityPlans,
  releaseDailySnapshots,
  workItems,
  tasks,
} from '../../../../../db/schema/work';
import {
  completedScheduleStatesSql,
  acceptedScheduleStatesSql,
  type ReleaseStatus,
} from '../../../../../db/schema/enums';
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
 * A release's Story/Defect roll-up. `progressPercent` is null when it cannot be computed
 * — see `computeTaskRollups`.
 */
export interface TaskRollup {
  totalItems: number;
  completedItems: number;
  acceptedItems: number;
  toDoItems: number;
  totalPoints: number;
  completedPoints: number;
  toDoPoints: number;
  progressPercent: number | null;
}

/** A release with no linked Story/Defect at all: zero counts, and no computable percent. */
const EMPTY_TASK_ROLLUP: TaskRollup = {
  totalItems: 0,
  completedItems: 0,
  acceptedItems: 0,
  toDoItems: 0,
  totalPoints: 0,
  completedPoints: 0,
  toDoPoints: 0,
  progressPercent: null,
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
    // Both roll-ups are batched over the whole page. `taskRollup` used to be built only
    // in the detail path, so every list consumer saw `undefined` — the Reports "Release
    // Progress" widget read `?? 0` off it and painted EVERY release at 0%, including
    // finished ones. One extra grouped query is the fix; hiding it behind a default was
    // the bug.
    const [estimates, rollups] = await Promise.all([
      this.computeTaskEstimates(ids),
      this.computeTaskRollups(ids),
    ]);
    return {
      ...page,
      data: page.data.map((r) => ({
        ...r,
        taskEstimate: estimates.get(r.id) ?? 0,
        taskRollup: rollups.get(r.id) ?? EMPTY_TASK_ROLLUP,
      })),
    };
  }

  /**
   * Story/Defect roll-up per release, batched over a page.
   *
   * `progressPercent` is NULLABLE, and that is the point: `null` means "not computable"
   * — nothing linked, or nothing estimated and not everything finished. Returning 0 there
   * would state that none of the work is done, which is a completely different claim from
   * "we cannot tell", and it is what made an unestimated release render as a confident 0%.
   * The all-items-done shortcut is kept, because a release whose every item is accepted IS
   * 100% regardless of whether anyone estimated it.
   */
  private async computeTaskRollups(releaseIds: string[]): Promise<Map<string, TaskRollup>> {
    if (releaseIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        releaseId: workItems.releaseId,
        totalItems: sql<number>`COUNT(*)::int`,
        completedItems: sql<number>`COUNT(*) FILTER (WHERE ${workItems.scheduleState} IN (${completedScheduleStatesSql()}))::int`,
        acceptedItems: sql<number>`COUNT(*) FILTER (WHERE ${workItems.scheduleState} IN (${acceptedScheduleStatesSql()}))::int`,
        totalPoints: sql<number>`COALESCE(SUM(${workItems.storyPoints}), 0)`,
        completedPoints: sql<number>`COALESCE(SUM(${workItems.storyPoints}) FILTER (WHERE ${workItems.scheduleState} IN (${completedScheduleStatesSql()})), 0)`,
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

    const map = new Map<string, TaskRollup>();
    for (const r of rows) {
      if (!r.releaseId) continue;
      const totalPoints = Number(r.totalPoints);
      const completedPoints = Number(r.completedPoints);
      const allItemsDone = r.totalItems > 0 && r.completedItems === r.totalItems;
      map.set(r.releaseId, {
        totalItems: r.totalItems,
        completedItems: r.completedItems,
        acceptedItems: r.acceptedItems,
        toDoItems: r.totalItems - r.completedItems,
        totalPoints,
        completedPoints,
        toDoPoints: totalPoints - completedPoints,
        progressPercent:
          totalPoints > 0
            ? Math.min(Math.round((completedPoints / totalPoints) * 100), 100)
            : allItemsDone
              ? 100
              : null,
      });
    }
    return map;
  }

  /**
   * SRS §6.1 / FR-004 — the "Task Estimate" list column is a read-only roll-up:
   * the summed estimate hours of the child tasks under the stories/defects
   * assigned to each release. Mirrors the Iteration Status definition
   * (sum of `tasks.estimate_hours`), so both surfaces report the same number.
   * Batched to avoid N+1 across a listed page. Releases with no assigned work
   * (or no task estimates) resolve to 0.
   */
  private async computeTaskEstimates(releaseIds: string[]): Promise<Map<string, number>> {
    if (releaseIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        releaseId: workItems.releaseId,
        estimate: sql<number>`COALESCE(SUM(${tasks.estimateHours}), 0)`,
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
    const map = new Map<string, number>();
    for (const r of rows) if (r.releaseId) map.set(r.releaseId, Number(r.estimate));
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
    await this.projectsService.getProject(actor.workspaceId, projectId);

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

    await this.releaseRepo.delete(id);
    this.logger.log({ releaseId: id }, 'Release deleted');
  }

  // ── Get Detail (includes task rollup) ─────────────────────────────────────

  async shipRelease(actor: JwtPayload, id: string): Promise<Release> {
    const release = await this.getRelease(actor.workspaceId, id);
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
    const rollup = rollups.get(id) ?? EMPTY_TASK_ROLLUP;

    const estimates = await this.computeTaskEstimates([id]);

    return {
      ...release,
      taskEstimate: estimates.get(id) ?? 0,
      taskRollup: rollup,
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

  // ── Burndown ─────────────────────────────────────────────────────────────

  async getReleaseBurndown(actor: JwtPayload, releaseId: string) {
    await this.getReleaseForView(actor, releaseId);

    const snapshots = await this.db
      .select()
      .from(releaseDailySnapshots)
      .where(eq(releaseDailySnapshots.releaseId, releaseId))
      .orderBy(releaseDailySnapshots.snapshotDate, asc(releaseDailySnapshots.id));

    return snapshots.map((s) => ({
      date: s.snapshotDate,
      totalPoints: Number(s.totalPoints),
      completedPoints: Number(s.completedPoints),
      remainingPoints: Number(s.remainingPoints),
      totalItems: s.totalItems,
      completedItems: s.completedItems,
    }));
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
