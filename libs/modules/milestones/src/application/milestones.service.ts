import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import {
  InjectDrizzle,
  NotFoundException,
  PreconditionFailedException,
  buildPageResult,
} from '@platform';
import type { JwtPayload, CursorPayload, PagedResult, DrizzleDB } from '@platform';
import { and, asc, desc, eq, isNull, sql, inArray, type Column, type SQL } from 'drizzle-orm';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { PERMISSION, type ProjectPermission } from '@shared-kernel';
import {
  workItems,
  portfolioItems,
  milestones,
  milestoneArtifacts,
  milestoneReleases,
  releases,
  projects,
  teams,
} from '../../../../../db/schema/work';
import { completedScheduleStatesSql } from '../../../../../db/schema/enums';
import {
  IMilestoneRepository,
  MILESTONE_REPOSITORY,
  type MilestoneArtifactLink,
} from '../domain/ports/milestone.repository';
import type {
  Milestone,
  MilestoneOption,
  MilestoneStatus,
  UpdateMilestoneInput,
} from '../domain/milestone.types';
import { ActivityLogger, type ActivityLog } from '@modules/activity';
import { MILESTONE_ACTIVITY_CONFIG } from './milestone-activity-diff';

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

export interface MilestoneProgress {
  totalItems: number;
  completedItems: number;
  totalPoints: number;
  completedPoints: number;
  /** Null when not computable — nothing estimated and not everything finished. */
  progressPercent: number | null;
}

/**
 * One row of the Milestone Artifacts dashboard.
 *
 * Deliberately the same column set `ReleasesService.listReleaseArtifacts` returns plus
 * `assigneeName`: the SPA renders both through one shared table, whose Owner column had nothing to
 * read on either surface.
 *
 * `scheduleState` and `priority` are `''` for a PORTFOLIO row, and `storyPoints` is null — a
 * Feature or Epic carries none of the three. Its `state` is a different axis from a Story's Schedule
 * State, `portfolio_items` has no priority column at all, and a portfolio forecast is the tiered
 * top-down estimate the Portfolio surface resolves (AC-014) rather than a leaf Plan Estimate; Rally
 * keeps those apart as `Plan Estimate` and `Leaf Story Plan Estimate Total`. `''` is not a member of
 * either enum, so nothing can mistake it for a value. See `ReleaseArtifactRow`, which says the same
 * for the same reason on the same shared table.
 */
export interface MilestoneArtifactRow {
  id: string;
  itemKey: string;
  type: string;
  title: string;
  scheduleState: string;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  storyPoints: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A MICROSECOND, lexicographically ordered rendering of a timestamp, used to merge two tables'
 * pages into one order. Duplicated from `ReleasesService` deliberately — one line of SQL in each
 * of two modules, rather than a new cross-module export for it.
 *
 * `Date.getTime()` is MILLISECONDS and `timestamptz` is microseconds — the precision mismatch
 * `keysetCondition`'s own docblock is built around. Sorting the merged rows on `getTime()` would tie
 * two rows the database orders strictly, so the row a page ends on would not be the row the database
 * calls last and the next cursor would skip the straddling row for ever.
 */
function microsecondSortKey(col: Column): SQL<string> {
  return sql<string>`to_char(${col} at time zone 'UTC', 'YYYYMMDDHH24MISSUS')`;
}

/** Newest-first on the exact timestamp, id ascending — the `ORDER BY` both branches carry. */
function bySortKeyDesc(a: { sortKey: string; id: string }, b: { sortKey: string; id: string }) {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface ReleaseStats {
  totalItems: number;
  completedItems: number;
  totalPoints: number;
  completedPoints: number;
}

/**
 * Valid status transitions. SRS FR-006 enumerates the milestone statuses but
 * does not prescribe a transition graph, so we keep the lifecycle permissive:
 * any status may move to any OTHER status, with `completed` as the single
 * terminal state (a completed milestone is done and cannot be reopened). This
 * avoids trapping users in the previous restrictive graph (e.g. a `met`
 * milestone that could only go to `completed`) while still preventing the one
 * invariant the product needs — no resurrection of a completed milestone.
 * NOTE for BA sign-off: confirm whether any additional terminal/locked states
 * are required; this graph is intentionally the least-restrictive safe default.
 */
const ALL_MILESTONE_STATUSES: MilestoneStatus[] = [
  'planned',
  'at_risk',
  'met',
  'missed',
  'cancelled',
  'completed',
];
const others = (self: MilestoneStatus): MilestoneStatus[] =>
  ALL_MILESTONE_STATUSES.filter((s) => s !== self);
const MILESTONE_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
  planned: others('planned'),
  at_risk: others('at_risk'),
  met: others('met'),
  missed: others('missed'),
  cancelled: others('cancelled'),
  completed: [], // terminal — a completed milestone cannot be reopened
};

@Injectable()
export class MilestonesService {
  private readonly logger = new Logger(MilestonesService.name);

  constructor(
    @Inject(MILESTONE_REPOSITORY) private readonly milestoneRepo: IMilestoneRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
    private readonly activity: ActivityLogger,
  ) {}

  // ── Revision History (activity log) ─────────────────────────────────────────

  /** Newest-first revision history for one milestone (workspace-view gated). */
  async getMilestoneActivity(
    actor: JwtPayload,
    id: string,
    args: { limit: number; offset: number },
  ): Promise<{ items: ActivityLog[]; total: number }> {
    await this.getMilestoneForView(actor, id);
    const page = Math.floor(args.offset / args.limit) + 1;
    const res = await this.activity.listFor(id, actor.workspaceId, page, args.limit);
    return { items: res.data, total: res.total };
  }

  private milestoneSubject(m: Milestone) {
    return {
      workspaceId: m.workspaceId,
      projectId: m.projectId,
      entityType: 'milestone' as const,
      entityId: m.id,
    };
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async listMilestones(
    actor: JwtPayload,
    projectId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Milestone & { progress?: MilestoneProgress }>> {
    await this.projectsService.getProject(actor.workspaceId, projectId);
    const page = await this.milestoneRepo.listByProject(projectId, actor.workspaceId, args);

    const progressByMilestone = await this.computeProgressBatch(page.data);
    return {
      ...page,
      data: page.data.map((m) => ({ ...m, progress: progressByMilestone.get(m.id) ?? undefined })),
    };
  }

  /**
   * The REFERENCE feed — every milestone in the project, projected to what a picker needs.
   *
   * Split out of {@link listMilestones} because that one is the `Plan > Milestones` administration
   * grid's feed and takes `milestone:view`, which §3.2 withholds from an Editor (it marks the whole
   * `Timeboxes` surface Hidden for one) — and it was ALSO the only feed for the Milestones column and
   * picker on Iteration Status and on the Work Item detail sidebar, both Editor surfaces. Every one of
   * those consumers defaults a failed request to `[]`, so an item's real milestones rendered as none
   * and none could be added. Same defect, same split and same reasoning as
   * `GET /releases/options` and `GET /projects/:id/member-options`.
   *
   * No progress computed here: `computeProgressBatch` aggregates work items for a number a picker does
   * not show, and it is administration data an Editor must not read. So this is also the cheap call.
   */
  async listMilestoneOptions(actor: JwtPayload, projectId: string): Promise<MilestoneOption[]> {
    await this.projectsService.getProject(actor.workspaceId, projectId);
    return this.milestoneRepo.listOptionsByProject(projectId, actor.workspaceId);
  }

  /**
   * Single guard that every milestone link write funnels through: the linked
   * projects, teams and releases must all belong to the actor's workspace.
   * Mirrors the tenant-isolation rule enforced for project\u2194team links
   * (ProjectsService.linkTeam) so a milestone can never reference an entity
   * from another workspace/tenant. Each set is validated with one COUNT query;
   * a size mismatch means at least one id is foreign (or does not exist).
   */
  private async assertLinksInWorkspace(
    workspaceId: string,
    links: { projectIds?: string[]; teamIds?: string[]; releaseIds?: string[] },
  ): Promise<void> {
    const projectIds = [...new Set(links.projectIds ?? [])];
    const teamIds = [...new Set(links.teamIds ?? [])];
    const releaseIds = [...new Set(links.releaseIds ?? [])];

    if (projectIds.length > 0) {
      const rows = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            inArray(projects.id, projectIds),
            eq(projects.workspaceId, workspaceId),
            isNull(projects.deletedAt),
          ),
        );
      if (rows.length !== projectIds.length) {
        throw new PreconditionFailedException(
          'MILESTONE_PROJECT_NOT_IN_WORKSPACE',
          'One or more projects do not belong to this workspace',
        );
      }
    }

    if (teamIds.length > 0) {
      const rows = await this.db
        .select({ id: teams.id })
        .from(teams)
        .where(and(inArray(teams.id, teamIds), eq(teams.workspaceId, workspaceId)));
      if (rows.length !== teamIds.length) {
        throw new PreconditionFailedException(
          'MILESTONE_TEAM_NOT_IN_WORKSPACE',
          'One or more teams do not belong to this workspace',
        );
      }
    }

    if (releaseIds.length > 0) {
      const rows = await this.db
        .select({ id: releases.id })
        .from(releases)
        .where(and(inArray(releases.id, releaseIds), eq(releases.workspaceId, workspaceId)));
      if (rows.length !== releaseIds.length) {
        throw new PreconditionFailedException(
          'MILESTONE_RELEASE_NOT_IN_WORKSPACE',
          'One or more releases do not belong to this workspace',
        );
      }
    }
  }

  /**
   * May this caller decide MILESTONE membership for work that lives in `projectId`?
   *
   * `Phase 4/02_Roles_Permissions/SRS.md:80` is ONE row covering both halves of the Timeboxes
   * surface — `| Releases and Milestones | Create/View/Edit/Delete | Create/View/Edit/Delete |
   * Hidden |` — and `Phase 3/03_Milestones/SRS.md:138` restates it for this exact write ("Editor or
   * unassigned-user mutation must return 403"). The RELEASE half of that row is enforced by
   * `WorkItemsService.assertMayAssignRelease`; this is the MILESTONE half, and it was missing, so
   * one row had two verdicts.
   *
   * The ROUTES cannot express it. `PUT /work-items/:id/milestones` is gated on `work_item:edit` and
   * `PATCH /portfolio-items/:id` on `portfolio:edit` — codes the caller legitimately holds for every
   * other field of the same item — so the rule is FIELD-level. It lives HERE rather than at each
   * call site because `milestone_artifacts` has three writers and this file has already recorded
   * what happens when one of them enforces less than the others (see
   * {@link assertArtifactsInMilestoneScope}).
   *
   * `milestone:view` is the code, and it is not a new one: `ACCESS_LEVEL_PERMISSIONS` gives it to
   * `admin` and withholds it from `editor`, which is exactly the §3.2 line, and the authority to put
   * work on a milestone is the authority to see milestones at all. Same argument
   * `assertMayAssignRelease` makes for `release:view`.
   *
   * CLEARING is gated too, for the reason the release side gives: removing an item from a milestone
   * decides its membership as much as adding it. Callers must therefore reach this on an EMPTY set
   * as well, which is why it is separate from {@link assertArtifactsAssignable} — that one loops
   * over the requested milestones and is a no-op when there are none.
   */
  async assertMayAssignMilestones(actor: JwtPayload, projectId: string): Promise<void> {
    await this.accessService.assertProjectPermission(actor, projectId, PERMISSION.MILESTONE_VIEW);
  }

  /**
   * Assert the caller holds `permission` on every one of `projectIds`.
   *
   * `assertProjectPermission` rather than `listReadableProjectIds`, deliberately: the ids here are
   * already CONCRETE (they came off the rows being written), so the question is "may this caller
   * reach this project", not "which projects may they reach". That also means there is no
   * `null`-means-unrestricted sentinel to re-derive at a second call site — the one place that
   * distinction lives stays `AccessService` — and the refusal keeps the established
   * `PROJECT_PERMISSION_DENIED` code, so no new error code reaches the client. Cost is one cached
   * `effectiveAssignments` read for the whole loop, not one query per project.
   */
  private async assertProjectsAccessible(
    actor: JwtPayload,
    projectIds: Iterable<string>,
    permission: ProjectPermission,
  ): Promise<void> {
    for (const projectId of new Set(projectIds)) {
      await this.accessService.assertProjectPermission(actor, projectId, permission);
    }
  }

  /**
   * The caller must be able to SEE every project they are pulling into a milestone's scope.
   *
   * A milestone legitimately spans projects (FR-008 at §43, §70/§74, Q06 at §149), so this is not
   * "a milestone is single-project" — it is "you may only widen it into projects you can already
   * reach". Without it, `milestone:edit` on project A was enough to link project B, which put B's
   * items inside `assertArtifactsInMilestoneScope`'s accepted population and made them readable
   * through `GET /milestones/:id/artifacts/items` — a route gated `milestone:view` on A.
   *
   * `project:view` is the code, not something stronger. The rows a linked project can expose are
   * each separately gated: attaching one of its artifacts now needs `work_item:view` /
   * `portfolio:view` on that project (see {@link setMilestoneArtifacts}), and the dashboard only
   * ever renders ATTACHED artifacts. Requiring `milestone:view` on the far project instead would
   * make a cross-project milestone reachable only by a Workspace Admin, which FR-008 does not say.
   *
   * ADDITIONS only. Removing a project the caller cannot see is allowed, or a milestone widened by
   * someone else would be permanently un-narrowable by the admin of its own project. The milestone's
   * OWN project is never an addition — the route's `milestone:edit` gate already decided it.
   */
  private async assertProjectLinksAccessible(
    actor: JwtPayload,
    milestoneProjectId: string,
    currentProjectIds: readonly string[],
    requestedProjectIds: readonly string[],
  ): Promise<void> {
    const already = new Set<string>([milestoneProjectId, ...currentProjectIds]);
    await this.assertProjectsAccessible(
      actor,
      requestedProjectIds.filter((id) => !already.has(id)),
      PERMISSION.PROJECT_VIEW,
    );
  }

  // ── Recalculate target dates from linked releases ──────────────────────

  /**
   * Derive targetStartDate / targetEndDate from the linked releases
   * (MIN start / MAX release date) and persist them — but ONLY while at least
   * one Release is linked. With no linked Release the milestone's dates are
   * user-managed (reconciled SRS §2 / P3-MS-019), so this is a no-op and the
   * manually-entered dates are left untouched.
   */
  private async recalcTargetDates(milestoneId: string, workspaceId: string): Promise<void> {
    const result = await this.db
      .select({
        startDate: sql<string | null>`MIN(${releases.startDate})`,
        endDate: sql<string | null>`MAX(${releases.releaseDate})`,
        linked: sql<number>`COUNT(${releases.id})`,
      })
      .from(milestoneReleases)
      .innerJoin(releases, eq(milestoneReleases.releaseId, releases.id))
      .where(
        and(eq(milestoneReleases.milestoneId, milestoneId), eq(releases.workspaceId, workspaceId)),
      );

    const row = result[0];
    // No linked Release → dates are manual; do not override or clear them.
    if (!row || Number(row.linked) === 0) return;

    await this.db
      .update(milestones)
      .set({ targetStartDate: row.startDate, targetEndDate: row.endDate, updatedAt: new Date() })
      .where(eq(milestones.id, milestoneId));
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createMilestone(
    actor: JwtPayload,
    projectId: string,
    name: string,
    opts: {
      description?: string;
      notes?: string;
      status?: string;
      ownerId?: string;
      targetStartDate?: string;
      targetEndDate?: string;
      releaseIds?: string[];
      projectIds?: string[];
      teamIds?: string[];
    } = {},
  ): Promise<Milestone> {
    await this.projectsService.assertProjectWritable(actor.workspaceId, projectId);

    // Tenant isolation: every linked project/team/release must live in this
    // workspace before we persist any link (defense in depth beyond RLS).
    await this.assertLinksInWorkspace(actor.workspaceId, {
      projectIds: opts.projectIds,
      teamIds: opts.teamIds,
      releaseIds: opts.releaseIds,
    });

    // Every additional project is an ADDITION here — see `assertProjectLinksAccessible`. The rule is
    // on all three writes that can reach `milestone_projects` rather than on the obvious one:
    // CLAUDE.md's "a rule stated as an INVARIANT cannot be implemented as one write's hook".
    await this.assertProjectLinksAccessible(actor, projectId, [], opts.projectIds ?? []);

    const releaseIds = opts.releaseIds ?? [];

    // milestoneKey reservation reads MAX(existing) + 1 (not atomic under
    // concurrent creates) and milestones can be deleted, so a collision on
    // uq_milestones_key is possible; retry once with a freshly computed key.
    // Only the create is retried — link writes below run once, after success.
    const MAX_KEY_RETRIES = 2;
    let milestone: Milestone | undefined;
    let lastErr: unknown;

    for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt++) {
      const keyNumber = await this.milestoneRepo.nextKeyNumber(projectId, actor.workspaceId);
      try {
        milestone = await this.milestoneRepo.create({
          id: uuidv7(),
          workspaceId: actor.workspaceId,
          projectId,
          milestoneKey: `MS-${keyNumber}`,
          name,
          description: opts.description,
          notes: opts.notes,
          status: (opts.status as MilestoneStatus) ?? 'planned',
          ownerId: opts.ownerId,
          // Manual dates persist; recalcTargetDates below overrides them only
          // when releases are linked (reconciled SRS §2).
          targetStartDate: opts.targetStartDate,
          targetEndDate: opts.targetEndDate,
          releaseIds,
          projectIds: opts.projectIds,
          teamIds: opts.teamIds,
        });
        break;
      } catch (err: unknown) {
        lastErr = err;
        if (isDuplicateKeyError(err) && attempt < MAX_KEY_RETRIES - 1) {
          this.logger.warn(
            { projectId, attempt: attempt + 1 },
            'Duplicate milestone key — retrying',
          );
          continue;
        }
        throw err;
      }
    }

    if (!milestone) throw lastErr;

    if (releaseIds.length > 0) {
      await this.milestoneRepo.setReleaseLinks(milestone.id, releaseIds);
    }
    if (opts.projectIds?.length) {
      await this.milestoneRepo.setProjectLinks(milestone.id, opts.projectIds);
    }
    if (opts.teamIds?.length) {
      await this.milestoneRepo.setTeamLinks(milestone.id, opts.teamIds);
    }

    // Derive target dates from linked releases (read-only) when any are linked;
    // otherwise the manual dates set above are kept (recalc is a no-op).
    await this.recalcTargetDates(milestone.id, actor.workspaceId);

    const final = await this.milestoneRepo.findById(milestone.id);
    this.logger.log(
      { milestoneId: milestone.id, projectId, userId: actor.sub },
      'Milestone created',
    );
    await this.activity.logSafe([
      this.activity.build(this.milestoneSubject(final!), actor.sub, 'milestone.created', null),
    ]);
    return final!;
  }

  // ── Get ───────────────────────────────────────────────────────────────────

  /**
   * Load a milestone for a READ, enforcing `milestone:view` at its project scope
   * — not just workspace membership — so a user scoped to one project cannot read
   * another project's milestones in the same workspace. Mirrors getWorkItemForView.
   */
  async getMilestoneForView(
    actor: JwtPayload,
    id: string,
  ): Promise<Milestone & { progress?: MilestoneProgress }> {
    // Project-scoped milestone:view is enforced by the PolicyGuard at the route
    // (resource-resolved from :id); this just loads the row.
    return this.getMilestone(actor.workspaceId, id);
  }

  /**
   * Load a milestone (with its Project/Team/Release links) or refuse. The workspace check is
   * the isolation boundary here — `findById` is deliberately unscoped, so every caller has to
   * apply it, and one place that does is better than several that might.
   */
  private async requireMilestone(workspaceId: string, id: string): Promise<Milestone> {
    const milestone = await this.milestoneRepo.findById(id);
    if (!milestone || milestone.workspaceId !== workspaceId) {
      throw new NotFoundException('MILESTONE_NOT_FOUND', 'Milestone not found');
    }
    return milestone;
  }

  async getMilestone(
    workspaceId: string,
    id: string,
  ): Promise<Milestone & { progress?: MilestoneProgress }> {
    const milestone = await this.requireMilestone(workspaceId, id);

    /**
     * No repair on the read path any more.
     *
     * This used to call `recalcTargetDates` on every GET, which is why the detail page looked correct
     * while `listMilestones` showed a stale window — the surface a reviewer checks was the one that
     * healed itself. The derived window is maintained by migration 0097's triggers now, on all three
     * writes that can invalidate it (a release date edit, a link add/remove, a manual write to a linked
     * milestone), so a read is just a read and both surfaces agree.
     */
    const progress = await this.computeProgress(milestone.releaseIds);
    return { ...milestone, progress: progress ?? undefined };
  }

  /**
   * Compute progress across all releases linked to a milestone.
   */
  private async computeProgress(releaseIds: string[]): Promise<MilestoneProgress | null> {
    if (releaseIds.length === 0) return null;
    const byRelease = await this.fetchReleaseStats(releaseIds);
    return this.aggregateProgress(releaseIds, byRelease);
  }

  /**
   * Compute progress for many milestones at once (one query for all releases
   * involved, instead of N+1 per-milestone queries on the list page).
   */
  private async computeProgressBatch(
    milestones: Milestone[],
  ): Promise<Map<string, MilestoneProgress>> {
    const allReleaseIds = [...new Set(milestones.flatMap((m) => m.releaseIds))];
    const byRelease = await this.fetchReleaseStats(allReleaseIds);

    const result = new Map<string, MilestoneProgress>();
    for (const m of milestones) {
      const progress = this.aggregateProgress(m.releaseIds, byRelease);
      if (progress) result.set(m.id, progress);
    }
    return result;
  }

  /** Per-release work-item stats, grouped by `releaseId`. */
  private async fetchReleaseStats(releaseIds: string[]): Promise<Map<string, ReleaseStats>> {
    if (releaseIds.length === 0) return new Map();

    const stats = await this.db
      .select({
        releaseId: workItems.releaseId,
        totalItems: sql<number>`COUNT(*)`,
        completedItems: sql<number>`COUNT(*) FILTER (WHERE schedule_state IN (${completedScheduleStatesSql()}))`,
        totalPoints: sql<number>`COALESCE(SUM(CASE WHEN story_points IS NOT NULL THEN story_points ELSE 0 END), 0)`,
        completedPoints: sql<number>`COALESCE(SUM(CASE WHEN schedule_state IN (${completedScheduleStatesSql()}) THEN story_points ELSE 0 END), 0)`,
      })
      .from(workItems)
      .where(
        and(
          inArray(workItems.releaseId, releaseIds),
          isNull(workItems.deletedAt),
          sql`type IN ('story', 'defect')`,
        ),
      )
      .groupBy(workItems.releaseId);

    return new Map(
      stats.filter((s) => s.releaseId !== null).map((s) => [s.releaseId as string, s]),
    );
  }

  private aggregateProgress(
    releaseIds: string[],
    byRelease: Map<string, ReleaseStats>,
  ): MilestoneProgress | null {
    if (releaseIds.length === 0) return null;

    let totalItems = 0;
    let completedItems = 0;
    let totalPoints = 0;
    let completedPoints = 0;
    for (const releaseId of releaseIds) {
      const s = byRelease.get(releaseId);
      if (!s) continue;
      totalItems += Number(s.totalItems);
      completedItems += Number(s.completedItems);
      totalPoints += Number(s.totalPoints);
      completedPoints += Number(s.completedPoints);
    }

    // NULL, not 0, when there is nothing to divide by. 0% asserts "none of this work is
    // done"; an unestimated milestone deserves "cannot tell". The all-items-done shortcut
    // stays: every item complete IS 100% whether or not anyone estimated it.
    const progressPercent =
      totalPoints > 0
        ? Math.min(Math.round((completedPoints / totalPoints) * 100), 100)
        : totalItems > 0 && completedItems === totalItems
          ? 100
          : null;

    return { totalItems, completedItems, totalPoints, completedPoints, progressPercent };
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateMilestone(
    actor: JwtPayload,
    id: string,
    input: UpdateMilestoneInput,
  ): Promise<Milestone> {
    const milestone = await this.getMilestone(actor.workspaceId, id);
    await this.projectsService.assertProjectWritable(actor.workspaceId, milestone.projectId);

    // Validate status transition
    if (input.status && input.status !== milestone.status) {
      const allowed = MILESTONE_TRANSITIONS[milestone.status] ?? [];
      if (!allowed.includes(input.status)) {
        throw new PreconditionFailedException(
          'MILESTONE_INVALID_TRANSITION',
          `Invalid milestone transition: ${milestone.status} → ${input.status}. Allowed: ${allowed.join(', ') || 'none (terminal)'}`,
        );
      }
    }

    if (input.releaseIds !== undefined) {
      await this.assertLinksInWorkspace(actor.workspaceId, { releaseIds: input.releaseIds });
      await this.milestoneRepo.setReleaseLinks(id, input.releaseIds);
    }
    if (input.projectIds !== undefined) {
      await this.assertLinksInWorkspace(actor.workspaceId, { projectIds: input.projectIds });
      await this.assertProjectLinksAccessible(
        actor,
        milestone.projectId,
        await this.milestoneRepo.getProjectIds(id),
        input.projectIds,
      );
      await this.milestoneRepo.setProjectLinks(id, input.projectIds);
    }
    if (input.teamIds !== undefined) {
      await this.assertLinksInWorkspace(actor.workspaceId, { teamIds: input.teamIds });
      await this.milestoneRepo.setTeamLinks(id, input.teamIds);
    }

    // Persist the patch (manual target dates included). recalcTargetDates then
    // overrides the dates with the derived Release window IFF releases are
    // linked; with none linked the manual dates just written are kept (SRS §2).
    const updated = await this.milestoneRepo.update(id, input);
    await this.recalcTargetDates(id, actor.workspaceId);
    const final = (await this.milestoneRepo.findById(id)) ?? updated;
    const [releaseIds, projectIds, teamIds] = await Promise.all([
      this.milestoneRepo.getReleaseIds(id),
      this.milestoneRepo.getProjectIds(id),
      this.milestoneRepo.getTeamIds(id),
    ]);
    await this.activity.logSafe(
      this.activity.buildDiff(
        this.milestoneSubject(final),
        actor.sub,
        milestone as unknown as Record<string, unknown>,
        input as Record<string, unknown>,
        MILESTONE_ACTIVITY_CONFIG,
        'milestone.updated',
      ),
    );
    return { ...final, releaseIds, projectIds, teamIds };
  }

  // ── Artifact management (P3.3) ──────────────────────────────────────

  async getMilestoneArtifacts(actor: JwtPayload, milestoneId: string): Promise<string[]> {
    await this.getMilestoneForView(actor, milestoneId);
    return this.milestoneRepo.getArtifactIds(milestoneId);
  }

  /**
   * The Artifacts dashboard's ROWS — the same shape `ReleasesService.listReleaseArtifacts` serves,
   * because both feed the one shared `ArtifactsTabView`/`ArtifactTable` on the SPA side.
   *
   * `getMilestoneArtifacts` above answers with link IDS, which is what the replace-set picker needs
   * and what this route used to return. The tab cannot render an id: it wants key, title, schedule
   * state, priority, owner and estimate, paged and searchable. So the SPA read the ids response as
   * `{ data, pageInfo }`, got `undefined` for both, and the Milestone Artifacts tab rendered "No
   * artifacts linked to this milestone" for every milestone — including the seeded `MS-1`, which has
   * had a linked story since the demo fixture was written. Two shapes, one route, and the mismatch
   * was invisible because the empty state is a legitimate answer.
   *
   * `q` is honoured here (item key or title), unlike on the release side, because the shared toolbar
   * puts a search box above this table and sends the term.
   *
   * THE TABLE IS POLYMORPHIC AND THIS READ WAS NOT (`GAP-P3-MS-002`). `milestone_artifacts` became
   * `(entity_type, entity_id)` in migration 0084 because "a milestone can be assigned to a work item
   * OR to a portfolio item" — the Feature/Epic detail rail writes `'portfolio_item'` rows and reads
   * them back, which is why the Feature shows its Milestone. This query hardcoded
   * `entity_type = 'work_item'`, so there were two writers and one reader: FE-6 assigned to MS-1
   * persisted, displayed on the Feature, and was absent from MS-1's own Artifacts tab.
   *
   * INHERITED DESCENDANTS ARE COMPUTED ON READ, and only on read. A Feature or Epic assigned to a
   * milestone brings its leaf Stories/Defects into the milestone's display scope — which is what
   * Rally's own milestone Artifacts roll-ups mean by `Leaf Story Plan Estimate Total` and
   * `Accepted Leaf Story Count`. Three reasons it is not materialised into link rows:
   *   • `portfolio_items` already computes every rollup on read for a stated reason (`work.ts`: Rally
   *     stores its rollups and consequently ships a "Correct rollup discrepancy" action to repair
   *     drift; computing on read means that cannot happen). This is the same aggregate, on the same
   *     hierarchy, one table over.
   *   • materialised rows would need triggers on `work_items.feature_id`, on `portfolio_items.parent_id`
   *     and on every insert into either — and `db/seeds/**` writes both directly.
   *   • worse, `getArtifactIds` feeds the §5.2 replace-SET picker. Inherited rows in that list would
   *     come back as DIRECT links on the next save, silently promoting a descendant to an assignment
   *     the user never made.
   * Note this is a derived VIEW, not the read-repair the working notes warn about: nothing is
   * written, so no other reader can go stale.
   *
   * ONCE, NOT TWICE. "Descendants enter the inherited scope once, without duplicate counting" is
   * structural here rather than a de-duplication pass: the work-item branch is ONE scan of
   * `work_items` whose predicate is `directly linked OR reachable through a linked Feature/Epic`, so a
   * Story that is both cannot produce two rows and cannot be counted twice. A `UNION` of two
   * work-item selects plus a `DISTINCT` would have been the same population by a route where the
   * count and the rows could disagree.
   *
   * TWO BRANCHES, `limit + 1` EACH, merged. See `ReleasesService.listReleaseArtifacts`: each branch
   * is paged under the same keyset predicate and the same `ORDER BY`, and the merge takes `limit + 1`
   * of the union, which is exact. A per-branch `limit` would silently truncate. The two branches are
   * different TABLES, so their counts sum.
   *
   * No `type` predicate on the work-item branch, deliberately, because the previous query had none:
   * `assertArtifactsInMilestoneScope` refuses a Task today (SRS:116), but the work-item write path
   * enforced less than that before it was unified, so a Task-typed row may exist in an older database
   * and hiding a link that really is there is not this read's job. The inherited half needs no
   * predicate either — `feature_id` is a leaf-item column.
   */
  async listMilestoneArtifacts(
    actor: JwtPayload,
    milestoneId: string,
    args: { limit: number; cursor: CursorPayload | null; q?: string },
  ): Promise<PagedResult<MilestoneArtifactRow>> {
    await this.getMilestoneForView(actor, milestoneId);

    /** The milestone's DIRECT work-item links — the set that decides `direct` from `inherited`. */
    const directWorkItemIds = sql`(
      select ma.entity_id from ${milestoneArtifacts} ma
      where ma.milestone_id = ${milestoneId} and ma.entity_type = 'work_item'
    )`;
    /**
     * Its DIRECT portfolio links. `milestone_artifacts` carries no `workspace_id`, so the tenant
     * predicate rides on the joined row — the same reason the portfolio repository's own reader
     * joins `milestones` for it. Archived items are excluded here, which is what also keeps an
     * archived Feature's children out of the inherited set below.
     */
    const directPortfolioIds = sql`(
      select pi.id from ${milestoneArtifacts} ma
      join ${portfolioItems} pi on pi.id = ma.entity_id
      where ma.milestone_id = ${milestoneId}
        and ma.entity_type = 'portfolio_item'
        and pi.workspace_id = ${actor.workspaceId}
        and pi.archived_at is null
    )`;
    /**
     * The milestone's whole PORTFOLIO population: every directly linked Epic or Feature, PLUS the
     * child Features of a directly linked Epic.
     *
     * TWO LEVELS and no more, and the same shape as
     * `PortfolioItemDrizzleRepository.rollupSubqueries()`'s `linked` predicate — a work item attaches
     * to the LOWEST portfolio level only, so a Story never names an Epic and an Epic is reached
     * through its Features. Reusing that shape is what keeps a milestone's inherited set and a
     * Feature's own rollup describing the same children.
     *
     * It serves BOTH branches below, and that is FR-029: "Directly assigning an Epic includes its
     * child Features and their Story/Defect descendants" (SRS:64, restated at §117 and AC-8 §165).
     * The work-item branch always used this set; the portfolio branch matched `directPortfolioIds`
     * alone, so an Epic's child Features never appeared as artifact ROWS while their Stories did —
     * the Story/Defect half of FR-029 was present and the Feature half was missing, which reads on
     * screen as leaf work with no parent to explain it.
     *
     * De-duplication is structural, not a pass: this is ONE scan of `portfolio_items` whose predicate
     * is `direct OR child-of-direct`, so a Feature that is both (assigned in its own right AND under
     * an assigned Epic) cannot produce two rows — FR-030's "de-duplicated by stable item ID".
     */
    const artifactPortfolioIds = sql`(
      select pf.id from ${portfolioItems} pf
      where pf.archived_at is null
        and pf.workspace_id = ${actor.workspaceId}
        and (pf.id in ${directPortfolioIds} or pf.parent_id in ${directPortfolioIds})
    )`;

    const term = args.q?.trim();
    const like = term ? `%${term}%` : null;

    const workConditions = [
      eq(workItems.workspaceId, actor.workspaceId),
      isNull(workItems.deletedAt),
      // `feature_id` is a LEAF column, so only the Feature members of the set above can ever match —
      // an Epic id cannot appear here, which is why one set serves both branches.
      sql`(${workItems.id} in ${directWorkItemIds} or ${workItems.featureId} in ${artifactPortfolioIds})`,
    ];
    if (like) {
      workConditions.push(
        sql`(${workItems.itemKey} ilike ${like} or ${workItems.title} ilike ${like})`,
      );
    }

    // The direct Epics/Features AND an assigned Epic's child Features (FR-029). Previously
    // `directPortfolioIds` alone, which emitted the Epic and its Stories but not the Features between.
    const portfolioConditions = [sql`${portfolioItems.id} in ${artifactPortfolioIds}`];
    if (like) {
      portfolioConditions.push(
        sql`(${portfolioItems.itemKey} ilike ${like} or ${portfolioItems.name} ilike ${like})`,
      );
    }

    // Totals before the cursor/limit, for the footer count.
    const workCountConditions = [...workConditions];
    const portfolioCountConditions = [...portfolioConditions];

    if (args.cursor) {
      // The boundary is resolved IN the database from whichever table holds the cursor's row —
      // `keysetCondition` reads it from one table only, and a `timestamptz` must not round-trip
      // through the cursor at millisecond precision. See the release side for the full account.
      const cursorId = args.cursor.id;
      const boundary = sql`(select b.ts from (
          select cw.created_at as ts from ${workItems} cw where cw.id = ${cursorId}
          union all
          select cp.created_at as ts from ${portfolioItems} cp where cp.id = ${cursorId}
        ) b limit 1)`;
      const after = (createdAt: Column, id: Column) =>
        sql`(${createdAt} < ${boundary} or (${createdAt} = ${boundary} and ${id} > ${cursorId}))`;
      workConditions.push(after(workItems.createdAt, workItems.id));
      portfolioConditions.push(after(portfolioItems.createdAt, portfolioItems.id));
    }

    const [workRows, portfolioRows, workCount, portfolioCount] = await Promise.all([
      this.db
        .select({
          sortKey: microsecondSortKey(workItems.createdAt),
          id: workItems.id,
          itemKey: workItems.itemKey,
          type: sql<string>`${workItems.type}::text`,
          title: workItems.title,
          scheduleState: sql<string>`${workItems.scheduleState}::text`,
          priority: sql<string>`${workItems.priority}::text`,
          assigneeId: workItems.assigneeId,
          assigneeName: sql<string | null>`assignee_user.display_name`,
          storyPoints: sql<number | null>`${workItems.storyPoints}::float8`,
          createdAt: workItems.createdAt,
          updatedAt: workItems.updatedAt,
        })
        .from(workItems)
        .leftJoin(sql`identity.users assignee_user`, sql`assignee_user.id = work_items.assignee_id`)
        .where(and(...workConditions))
        .orderBy(desc(workItems.createdAt), asc(workItems.id))
        .limit(args.limit + 1),
      this.db
        .select({
          sortKey: microsecondSortKey(portfolioItems.createdAt),
          id: portfolioItems.id,
          itemKey: portfolioItems.itemKey,
          type: sql<string>`${portfolioItems.type}::text`,
          title: portfolioItems.name,
          scheduleState: sql<string>`''`,
          priority: sql<string>`''`,
          assigneeId: portfolioItems.ownerId,
          assigneeName: sql<string | null>`owner_user.display_name`,
          storyPoints: sql<number | null>`null::float8`,
          createdAt: portfolioItems.createdAt,
          updatedAt: portfolioItems.updatedAt,
        })
        .from(portfolioItems)
        .leftJoin(sql`identity.users owner_user`, sql`owner_user.id = portfolio_items.owner_id`)
        .where(and(...portfolioConditions))
        .orderBy(desc(portfolioItems.createdAt), asc(portfolioItems.id))
        .limit(args.limit + 1),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(workItems)
        .where(and(...workCountConditions)),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(portfolioItems)
        .where(and(...portfolioCountConditions)),
    ]);

    const merged = [...workRows, ...portfolioRows].sort(bySortKeyDesc).slice(0, args.limit + 1);
    const total = Number(workCount[0]?.total ?? 0) + Number(portfolioCount[0]?.total ?? 0);

    return buildPageResult(
      merged.map((r) => ({
        id: r.id,
        itemKey: r.itemKey,
        type: r.type,
        title: r.title,
        scheduleState: r.scheduleState,
        priority: r.priority,
        assigneeId: r.assigneeId,
        assigneeName: r.assigneeName,
        storyPoints: r.storyPoints === null ? null : Number(r.storyPoints),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      args.limit,
      (w) => [w.createdAt.toISOString()],
      'desc',
      total,
    );
  }

  /**
   * §5.2's replace-SET: `{ "artifactIds": [...] }` "replaces the directly assigned Milestone
   * artifact list; inherited descendants are derived and are not written into this list".
   *
   * POLYMORPHIC, because the link table is (migration 0084) and §116 admits four types. It used to
   * take `workItemIds` and resolve them against `work_items` alone, which had two consequences: a
   * Feature or Epic could not be assigned from this end at all (`MILESTONE_INVALID_ARTIFACT_TYPE`,
   * while the Feature detail rail wrote the identical row from the other end), and the replace was
   * scoped to `entity_type = 'work_item'` so it could not REMOVE one either.
   *
   * Each id resolves from EXACTLY ONE table and its entity type is derived from where it was found,
   * so a caller never states it — the ids are uuids and the two key spaces do not overlap.
   * `resolved.length !== uniqueIds.length` therefore catches an id matching neither table and (for
   * free) one somehow matching both.
   *
   * NO archived-item predicate on the portfolio resolve, deliberately, and `getArtifactIds` below
   * has none either — so the pair round-trips exactly. A milestone holding an archived Feature can
   * be saved without silently dropping that link, which is what an archived filter on one half of a
   * replace-set would do. The DASHBOARD read excludes archived rows, so such a Feature contributes
   * nothing on screen; the link is history, and SRS:85 makes removing it the deliberate action.
   */
  async setMilestoneArtifacts(
    actor: JwtPayload,
    milestoneId: string,
    artifactIds: string[],
  ): Promise<string[]> {
    const milestone = await this.getMilestone(actor.workspaceId, milestoneId);
    // PRJ-FR-010. `createMilestone`, `updateMilestone` and `deleteMilestone` carried this rule and
    // the four replace-SET writes below did not, so an archived project's milestones kept their
    // artifacts, projects, teams and releases fully editable — and the release set additionally
    // rewrites the milestone's own target window (FR-011/012).
    await this.projectsService.assertProjectWritable(actor.workspaceId, milestone.projectId);
    const uniqueIds = [...new Set(artifactIds)];
    let links: MilestoneArtifactLink[] = [];
    if (uniqueIds.length > 0) {
      const [workRows, portfolioRows] = await Promise.all([
        this.db
          .select({
            id: workItems.id,
            projectId: workItems.projectId,
            teamId: workItems.teamId,
            type: sql<string>`${workItems.type}::text`,
          })
          .from(workItems)
          .where(
            and(
              inArray(workItems.id, uniqueIds),
              eq(workItems.workspaceId, actor.workspaceId),
              isNull(workItems.deletedAt),
            ),
          ),
        this.db
          .select({
            id: portfolioItems.id,
            projectId: portfolioItems.projectId,
            teamId: portfolioItems.teamId,
            type: sql<string>`${portfolioItems.type}::text`,
          })
          .from(portfolioItems)
          .where(
            and(
              inArray(portfolioItems.id, uniqueIds),
              eq(portfolioItems.workspaceId, actor.workspaceId),
            ),
          ),
      ]);
      const resolved = [...workRows, ...portfolioRows];
      // A missing row is an id naming no live artifact in this workspace. Reported as a scope
      // mismatch rather than a 404 because this is a replace-SET: the write is refused whole and
      // an unresolvable id is, from here, indistinguishable from one outside the scope.
      if (resolved.length !== uniqueIds.length) {
        throw new PreconditionFailedException(
          'MILESTONE_PROJECT_MISMATCH',
          'One or more artifacts do not belong to this milestone’s project scope',
        );
      }
      /**
       * §134: "Each artifact must be accessible to the current user." A SEPARATE condition from
       * §135's Project/Team scope, which is the milestone's own declared scope and says nothing
       * about the caller — this write resolved ids against the WORKSPACE and then checked only that
       * scope, so `milestone:edit` on the milestone's project was authority over artifacts in every
       * project the milestone reaches, including ones the caller holds nothing on.
       *
       * Per TABLE, because the two halves are not one audience: `work_item:view` is an Editor code
       * and `portfolio:view` is not (§3.2:82 hides Portfolio from an Editor entirely), so asking one
       * question for both would either over-refuse a Story or under-refuse a Feature. The read gates
       * on those surfaces are the same two codes, which is the property that matters — an artifact
       * is "accessible" here exactly when its own list would serve it.
       */
      await this.assertProjectsAccessible(
        actor,
        workRows.map((r) => r.projectId),
        PERMISSION.WORK_ITEM_VIEW,
      );
      await this.assertProjectsAccessible(
        actor,
        portfolioRows.map((r) => r.projectId),
        PERMISSION.PORTFOLIO_VIEW,
      );
      // Project, artifact TYPE and Team scope are all decided in ONE place, because the work-item
      // and portfolio-item sides write the same rows — see assertArtifactsInMilestoneScope.
      assertArtifactsInMilestoneScope(milestone, resolved);
      links = [
        ...workRows.map((r) => ({ entityType: 'work_item' as const, entityId: r.id })),
        ...portfolioRows.map((r) => ({ entityType: 'portfolio_item' as const, entityId: r.id })),
      ];
    }
    await this.milestoneRepo.setArtifactLinks(milestoneId, links);
    return this.milestoneRepo.getArtifactIds(milestoneId);
  }

  /**
   * The artifact-scope rule, applied from the WORK-ITEM side of the same link table
   * (`PUT /work-items/:id/milestones` → `WorkItemsService.setWorkItemMilestones`).
   *
   * It lives here, and the milestone is loaded here, because the rule reads the Milestone's
   * scope — its owning project plus its selected Projects and Teams. The caller passes the
   * work items it wants linked; N milestones × the caller's items is the same cross product
   * the milestone-side write checks with 1 milestone × N items.
   */
  async assertArtifactsAssignable(
    workspaceId: string,
    milestoneIds: string[],
    candidates: readonly MilestoneArtifactCandidate[],
  ): Promise<void> {
    for (const milestoneId of [...new Set(milestoneIds)]) {
      const milestone = await this.requireMilestone(workspaceId, milestoneId);
      /**
       * The archived-project rule is checked from this side too, and it has to be.
       *
       * `milestone_artifacts` has two write paths and the whole point of this method is that they
       * cannot answer differently — the docblock below records what happened the last time one of
       * them enforced less than the other. `setMilestoneArtifacts` refuses an archived project, so
       * without this a caller could add the same row from `PUT /work-items/:id/milestones` instead:
       * the work item's own project is checked by `WorkItemsService`, but the MILESTONE's may be a
       * different one (its scope spans `milestone_projects`), and that one would go unchecked.
       */
      await this.projectsService.assertProjectWritable(workspaceId, milestone.projectId);
      assertArtifactsInMilestoneScope(milestone, candidates);
    }
  }

  async getMilestoneProjects(actor: JwtPayload, milestoneId: string): Promise<string[]> {
    await this.getMilestoneForView(actor, milestoneId);
    return this.milestoneRepo.getProjectIds(milestoneId);
  }

  async setMilestoneProjects(
    actor: JwtPayload,
    milestoneId: string,
    projectIds: string[],
  ): Promise<string[]> {
    const milestone = await this.getMilestone(actor.workspaceId, milestoneId);
    await this.projectsService.assertProjectWritable(actor.workspaceId, milestone.projectId);
    await this.assertLinksInWorkspace(actor.workspaceId, { projectIds });
    await this.assertProjectLinksAccessible(
      actor,
      milestone.projectId,
      await this.milestoneRepo.getProjectIds(milestoneId),
      projectIds,
    );
    await this.milestoneRepo.setProjectLinks(milestoneId, projectIds);
    return this.milestoneRepo.getProjectIds(milestoneId);
  }

  async getMilestoneTeams(actor: JwtPayload, milestoneId: string): Promise<string[]> {
    await this.getMilestoneForView(actor, milestoneId);
    return this.milestoneRepo.getTeamIds(milestoneId);
  }

  async setMilestoneTeams(
    actor: JwtPayload,
    milestoneId: string,
    teamIds: string[],
  ): Promise<string[]> {
    const milestone = await this.getMilestone(actor.workspaceId, milestoneId);
    await this.projectsService.assertProjectWritable(actor.workspaceId, milestone.projectId);
    await this.assertLinksInWorkspace(actor.workspaceId, { teamIds });
    await this.milestoneRepo.setTeamLinks(milestoneId, teamIds);
    return this.milestoneRepo.getTeamIds(milestoneId);
  }

  async getMilestoneReleases(actor: JwtPayload, milestoneId: string): Promise<string[]> {
    await this.getMilestoneForView(actor, milestoneId);
    return this.milestoneRepo.getReleaseIds(milestoneId);
  }

  async setMilestoneReleases(
    actor: JwtPayload,
    milestoneId: string,
    releaseIds: string[],
  ): Promise<string[]> {
    const milestone = await this.getMilestone(actor.workspaceId, milestoneId);
    await this.projectsService.assertProjectWritable(actor.workspaceId, milestone.projectId);
    await this.assertLinksInWorkspace(actor.workspaceId, { releaseIds });
    await this.milestoneRepo.setReleaseLinks(milestoneId, releaseIds);
    // Target dates are derived from the linked releases (SRS FR-011/012), so
    // recompute them whenever the release set changes.
    await this.recalcTargetDates(milestoneId, actor.workspaceId);
    return this.milestoneRepo.getReleaseIds(milestoneId);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteMilestone(actor: JwtPayload, id: string): Promise<void> {
    const milestone = await this.getMilestone(actor.workspaceId, id);
    await this.projectsService.assertProjectWritable(actor.workspaceId, milestone.projectId);
    /**
     * The ASSOCIATIONS go, the artifacts stay — Rally: deleting a milestone "removes the association
     * from each work item… The work item itself is not deleted."
     *
     * `MilestoneDrizzleRepository.delete` does that itself, clearing all four junction tables before
     * deleting the row. Migration 0114 additionally gives each of them `ON DELETE CASCADE`, which is
     * a backstop rather than the mechanism: it covers the writers that bypass the repository
     * (`db/seeds/**`, raw SQL), and it closes a real gap in the repository, where those four deletes
     * and the milestone delete are five statements with no transaction around them.
     */
    await this.milestoneRepo.delete(id);
    this.logger.log({ milestoneId: id }, 'Milestone deleted; its artifact links are removed');
  }
}

/**
 * One candidate artifact — everything the scope rule below reads, and nothing about which TABLE it
 * came from.
 *
 * Deliberately table-agnostic: `work_items` and `portfolio_items` both supply `project_id`,
 * `team_id` and `type`, and `milestone_artifacts` has been polymorphic since migration 0084. A rule
 * that took a work item could not be the single rule for a link table with two row shapes.
 */
export interface MilestoneArtifactCandidate {
  projectId: string;
  teamId: string | null;
  type: string;
}

/**
 * The DIRECT artifact types (`Phase 3/03_Milestones/SRS.md:116`: "Valid direct artifact types are
 * Story, Defect, Feature and Epic. Task is excluded."; FR-014 at §49 says the same).
 *
 * Task's exclusion is the whole reason this is a list and not "anything that resolves": a Task's
 * Project, Team, Iteration and Release context is DERIVED through its parent Story/Defect, so a Task
 * on a milestone would be a second, independent assignment of a record that owns no scope of its own.
 */
const DIRECT_ARTIFACT_TYPES: ReadonlySet<string> = new Set(['story', 'defect', 'feature', 'epic']);

/** The milestone half: its owning project plus the Projects/Teams it additionally selects. */
export interface MilestoneArtifactScope {
  projectId: string;
  projectIds?: string[];
  teamIds?: string[];
}

/**
 * The ONE home of the artifact-link rule — `milestone_artifacts` has THREE write paths and they
 * must agree, because they write the same rows.
 *
 * `PUT /milestones/:id/artifacts` (one milestone, N artifacts) enforced all three conditions;
 * `PUT /work-items/:id/milestones` (one work item, N milestones) enforced only the first, and
 * not even in the same form. So a Task could be made a Milestone artifact, and an item on any
 * team could join a Team-scoped Milestone, as long as the request came in from the work-item
 * side — the Artifacts dashboard then rendered rows §5.1 says cannot exist, from a screen that
 * had refused to create them. Same class of defect as the two `@RequirePermission` gates chosen
 * for where the id lived: the rule was attached to a call site instead of to the link.
 *
 * The THIRD writer is `PATCH /portfolio-items/:id` with `milestoneIds` — the Feature/Epic detail
 * rail's multi-select. It was missed by that unification and ran its own
 * `eq(milestones.project_id, …)` match instead, which was too permissive (no team condition at all)
 * AND too strict (no `milestone_projects` union) at the same time. It calls this now.
 *
 *   • project — an artifact must belong to one of the Milestone's Projects, which is its OWNING
 *     project plus any additionally linked ones (SRS §88/§135, FR-021/023, and Q06 confirms a
 *     Milestone may span several). The work-item side used `milestones.project_id` alone, so a
 *     Milestone reachable from this project through `milestone_projects` was refused here and
 *     accepted there.
 *   • type — Story, Defect, Feature or Epic; Task is excluded (SRS:116, FR-014). This used to be
 *     Story/Defect only, so the BA's own Feature/Epic assignment was refused from the Milestone end
 *     with `MILESTONE_INVALID_ARTIFACT_TYPE` while the Feature detail rail wrote the identical
 *     `entity_type = 'portfolio_item'` row from the other — the asymmetry this function exists to
 *     prevent, reintroduced by the type list rather than by a call site. See
 *     {@link DIRECT_ARTIFACT_TYPES}.
 *   • team — when the Milestone selects Team scope, an artifact must be on one of those Teams.
 *     A team-agnostic item (`teamId === null`) is OUT of a team scope, not exempt from it:
 *     unlike an actor-side authorization check, which asks whether the CALLER may write, this
 *     asks whether the WORK is inside a declared scope, and "no team" is not one of them.
 *
 *     **An EPIC is the one exemption, and it is a DECLARED READING rather than a derived rule.**
 *     An Epic has no `team_id` at all — `ck_portfolio_epic_shape` forbids one, and §11.1 says "Epic
 *     is stored at Project level. It has no Team field." So the paragraph above cannot apply to it:
 *     `teamId === null` on an Epic is not an unset value a planner might fill in, it is the absence
 *     of the dimension. Applying the filter anyway would refuse EVERY Epic on every team-scoped
 *     Milestone, which makes FR-014's Epic support unreachable for those Milestones — a blanket
 *     refusal of a type §116 names, dressed as a scope check. A FEATURE is NOT exempt: it has the
 *     column, so `null` there means "not set" and the ordinary rule stands. Put to the BA; if they
 *     rule the other way, this predicate is the whole reversal.
 *
 * The prose is deliberately direction-neutral: one message has to read correctly whether the
 * caller named the milestone, the work item or the portfolio item.
 */
export function assertArtifactsInMilestoneScope(
  milestone: MilestoneArtifactScope,
  candidates: readonly MilestoneArtifactCandidate[],
): void {
  if (candidates.length === 0) return;

  const projectScope = new Set<string>([milestone.projectId, ...(milestone.projectIds ?? [])]);
  if (candidates.some((c) => !projectScope.has(c.projectId))) {
    throw new PreconditionFailedException(
      'MILESTONE_PROJECT_MISMATCH',
      'A milestone artifact must belong to one of the milestone’s projects',
    );
  }

  if (candidates.some((c) => !DIRECT_ARTIFACT_TYPES.has(c.type))) {
    throw new PreconditionFailedException(
      'MILESTONE_INVALID_ARTIFACT_TYPE',
      'Only stories, defects, features and epics can be assigned as milestone artifacts',
    );
  }

  const teamScope = milestone.teamIds ?? [];
  if (teamScope.length > 0) {
    const teamSet = new Set(teamScope);
    const outOfScope = (c: MilestoneArtifactCandidate): boolean =>
      // See the Epic exemption above: an Epic carries no team column, so a team predicate over it
      // is a refusal rather than a filter.
      c.type !== 'epic' && (c.teamId === null || !teamSet.has(c.teamId));
    if (candidates.some(outOfScope)) {
      throw new PreconditionFailedException(
        'MILESTONE_TEAM_MISMATCH',
        'A milestone artifact must belong to one of the milestone’s selected teams',
      );
    }
  }
}
