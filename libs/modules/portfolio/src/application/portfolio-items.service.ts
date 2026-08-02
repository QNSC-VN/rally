import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  PermissionDeniedException,
  PreconditionFailedException,
  UnitOfWork,
  between,
} from '@platform';
import { AccessService } from '@modules/access';
import { ActivityLogger, type ActivityLog } from '@modules/activity';
import { PORTFOLIO_ACTIVITY_CONFIG } from './portfolio-activity-diff';
import { PORTFOLIO_HEALTH_THRESHOLDS, computeHealth, type HealthResult } from '@shared-kernel';
import type { CursorPayload, JwtPayload, PagedResult } from '@platform';
import {
  capacityPlanAllocations,
  capacityPlans,
  projectTeams,
  releases,
  teams,
} from '../../../../../db/schema/work';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { and, eq } from 'drizzle-orm';
import type { PreliminaryEstimateMap } from '../../../../../db/schema/enums';
import { computePortfolioProgress, type PortfolioProgress } from '../domain/portfolio-rollup';
import { PreliminaryEstimateMapService } from './preliminary-estimate-map.service';
import {
  PORTFOLIO_ITEM_REPOSITORY,
  type IPortfolioItemRepository,
  type PortfolioChildItem,
} from '../domain/ports/portfolio-item.repository';
import type {
  CreatePortfolioItemInput,
  PortfolioItem,
  PortfolioItemView,
  PortfolioListRequest,
  PortfolioRankScope,
  UpdatePortfolioItemInput,
} from '../domain/portfolio-item.types';
import type { PortfolioItemType } from '../../../../../db/schema/enums';

/** `EP-` / `FE-` — the display-key prefix per portfolio type. */
const KEY_PREFIX: Record<PortfolioItemType, string> = { epic: 'EP', feature: 'FE' };

/** A portfolio item with its four computed progress indicators and its health verdict. */
export interface PortfolioItemWithProgress extends PortfolioItemView {
  progress: PortfolioProgress;
  /**
   * Rally's green/yellow/red/blue status for a portfolio item, computed against the
   * planned window (Broadcom TechDocs, "Using the Portfolio Items Page"): at risk when the
   * acceptance rate is >20% below the rate needed to finish by the Planned End Date, late
   * at >40%, blue once the end date has passed AND everything is done.
   *
   * Deliberately NOT applied to Releases/Iterations/Milestones: Rally documents this scheme
   * for portfolio items only, and shows a percent-complete state bar on those surfaces
   * instead — which this app already renders.
   */
  health: HealthResult;
}

/** One child type's share of the accepted-children rollup. */
export interface AcceptedChildrenGroup {
  type: 'story' | 'defect';
  points: number;
  count: number;
  acceptedPoints: number;
  acceptedCount: number;
}

/**
 * The "Total Accepted Children" panel on the detail page: accepted vs linked, in points or
 * item count, with a row per child type.
 *
 * `total` comes from the item's own rollup rather than from summing `byType`, so the panel
 * and the Percent Done indicators on the same page can never disagree — they are then
 * literally the same numbers. `byType` only splits that total up.
 *
 * A type with no children is still returned with zeroes: Rally shows "Defects: 0% 0/0"
 * rather than hiding the row, and a missing row would read as "this Feature cannot have
 * defects" instead of "it has none".
 */
export interface AcceptedChildrenRollup {
  total: { points: number; count: number; acceptedPoints: number; acceptedCount: number };
  byType: AcceptedChildrenGroup[];
}

/** The detail surface: the grid row plus the accepted-children breakdown and Milestones. */
export interface PortfolioItemDetail extends PortfolioItemWithProgress {
  acceptedChildren: AcceptedChildrenRollup;
  /** Assigned Milestones, name-ordered. The rail renders these as a multi-select. */
  milestones: { id: string; name: string }[];
}

/**
 * An empty page for the cases this service refuses to send to SQL.
 *
 * Carries `total: 0` because the list endpoint otherwise always reports a count, and a
 * footer that reads "0 of —" for a denied caller but "0 of 0" for a genuinely empty
 * project would look like two different bugs.
 */
function emptyPage(limit: number): PagedResult<PortfolioItemWithProgress> {
  return { data: [], pageInfo: { nextCursor: null, hasNextPage: false, limit, total: 0 } };
}

@Injectable()
export class PortfolioItemsService {
  constructor(
    @Inject(PORTFOLIO_ITEM_REPOSITORY) private readonly repo: IPortfolioItemRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly access: AccessService,
    private readonly uow: UnitOfWork,
    private readonly estimateMaps: PreliminaryEstimateMapService,
    private readonly activity: ActivityLogger,
  ) {}

  /**
   * The activity subject for one item. `entity_type: 'portfolio_item'` was added to the
   * shared enum by 0081; `activity_logs` needed nothing else, being polymorphic already.
   */
  private subject(item: Pick<PortfolioItem, 'id' | 'workspaceId' | 'projectId'>) {
    return {
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      entityType: 'portfolio_item' as const,
      entityId: item.id,
    };
  }

  /** Revision History for one item, paged. Mirrors the milestone/release endpoints. */
  async getActivity(
    actor: JwtPayload,
    id: string,
    args: { limit: number; offset: number },
  ): Promise<{ items: ActivityLog[]; total: number }> {
    // Existence + permission first, so a bad id is a 404 rather than an empty feed.
    await this.requireItem(actor, id);
    const page = Math.floor(args.offset / args.limit) + 1;
    const res = await this.activity.listFor(id, actor.workspaceId, page, args.limit);
    return { items: res.data, total: res.total };
  }

  async listItems(
    actor: JwtPayload,
    filter: PortfolioListRequest,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<PortfolioItemWithProgress>> {
    // An Epic has no Team, so a team filter can only ever match Features. The spec
    // shows an explicit "Filter not show item" message for Epic + specific Team rather
    // than an empty grid, so return empty here and let the UI say why.
    if (filter.teamId && filter.type === 'epic') {
      return emptyPage(args.limit);
    }

    // The authorization boundary for this cross-project list.
    //
    // The ROUTE only proves the caller may read the workspace — `portfolio:view` is
    // project-tier and this route's projectId is optional, so the guard cannot check it.
    // Without the filter below a Project Member would list every project's portfolio,
    // which contradicts BA spec §3.2 and Rally, where access follows project permission.
    //
    // `null` means unrestricted (workspace-wide grant). An empty array means "no
    // readable projects" and must return nothing rather than everything — the two are
    // deliberately distinguishable so this cannot fail open.
    const readable = await this.access.listReadableProjectIds(
      actor.workspaceId,
      actor.sub,
      'portfolio:view',
    );

    if (readable !== null) {
      if (readable.length === 0) {
        return emptyPage(args.limit);
      }
      // An explicit projectId must be one the caller can read; narrowing to the
      // intersection means a request for someone else's project returns empty rather
      // than leaking whether it exists.
      if (filter.projectId && !readable.includes(filter.projectId)) {
        // Same code `AccessService.assertProjectPermission` throws, so a client can
        // branch on one value regardless of which layer denied it. Arg order is
        // (code, message) — the single-arg form is the legacy message-only shape.
        throw new PermissionDeniedException(
          'PROJECT_PERMISSION_DENIED',
          'You do not have permission to perform this action on this project',
        );
      }
    }

    const page = await this.repo.listByFilter(
      actor.workspaceId,
      { ...filter, readableProjectIds: readable },
      args,
    );
    const map = await this.estimateMap(actor.workspaceId);
    // One clock for the whole page: two rows with identical dates and identical rollups
    // must never disagree because the loop crossed midnight between them.
    const today = new Date();

    return {
      data: page.data.map((item) => this.withProgress(item, map, today)),
      pageInfo: page.pageInfo,
    };
  }

  async getItem(actor: JwtPayload, id: string): Promise<PortfolioItemDetail> {
    const item = await this.repo.findViewById(id, actor.workspaceId);
    if (!item) {
      throw new NotFoundException('PORTFOLIO_ITEM_NOT_FOUND', 'Portfolio item not found');
    }
    const map = await this.estimateMap(actor.workspaceId);
    const [groups, milestones] = await Promise.all([
      this.repo.childRollupByType(id, actor.workspaceId),
      this.repo.listMilestones(id, actor.workspaceId),
    ]);
    return {
      ...this.withProgress(item, map),
      milestones,
      acceptedChildren: {
        total: {
          points: item.rollup.rollupPoints,
          count: item.rollup.rollupCount,
          acceptedPoints: item.rollup.acceptedPoints,
          acceptedCount: item.rollup.acceptedCount,
        },
        // Both types always present, zero-filled — see AcceptedChildrenRollup.
        byType: (['story', 'defect'] as const).map(
          (type) =>
            groups.find((g) => g.type === type) ?? {
              type,
              points: 0,
              count: 0,
              acceptedPoints: 0,
              acceptedCount: 0,
            },
        ),
      },
    };
  }

  async listChildren(
    actor: JwtPayload,
    id: string,
    args: { limit: number; cursor: CursorPayload | null; search?: string },
  ): Promise<PagedResult<PortfolioChildItem>> {
    // Existence check first, so a bad id is a 404 rather than an empty list that looks
    // like "this Feature has no children".
    const item = await this.repo.findById(id, actor.workspaceId);
    if (!item) {
      throw new NotFoundException('PORTFOLIO_ITEM_NOT_FOUND', 'Portfolio item not found');
    }
    return this.repo.listChildren(id, actor.workspaceId, args);
  }

  async listChildFeatures(actor: JwtPayload, id: string): Promise<PortfolioItemWithProgress[]> {
    const item = await this.repo.findById(id, actor.workspaceId);
    if (!item) {
      throw new NotFoundException('PORTFOLIO_ITEM_NOT_FOUND', 'Portfolio item not found');
    }
    const map = await this.estimateMap(actor.workspaceId);
    const children = await this.repo.listChildFeatures(id, actor.workspaceId);
    const today = new Date();
    return children.map((c) => this.withProgress(c, map, today));
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  /**
   * Create an Epic or a Feature.
   *
   * Authorization is per-PROJECT here, unlike the cross-project list: a write targets
   * exactly one project, so `assertProjectPermission` can and must check it.
   */
  async createItem(
    actor: JwtPayload,
    input: Omit<CreatePortfolioItemInput, 'workspaceId'>,
  ): Promise<PortfolioItemWithProgress> {
    await this.access.assertProjectPermission(actor, input.projectId, 'portfolio:create');
    this.assertShape(input.type, input);
    await this.assertReferences(actor.workspaceId, input.projectId, input);

    const scope: PortfolioRankScope = { workspaceId: actor.workspaceId, type: input.type };

    // The key is MAX+1, which is not atomic, so a concurrent create can take the same
    // number and lose the `uq_portfolio_item_key` race. Retry once with a fresh key —
    // the same shape releases use. A failed insert only leaves a numbering gap.
    const MAX_KEY_RETRIES = 2;
    let created: PortfolioItem | undefined;
    let lastErr: unknown;

    for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt++) {
      try {
        created = await this.uow.run(async (tx) => {
          // Rank is derived INSIDE the transaction under a per-scope advisory lock, and
          // both the read and the insert use `tx`. Computing it outside is a lock-free
          // read-modify-write: two creates read the same max, derive the SAME rank, and
          // the next drag-reorder throws on the equal neighbours. That is exactly how
          // work items ended up with 22 scopes sharing a rank.
          await this.repo.lockRankScope(scope, tx);
          const maxRank = await this.repo.findMaxRank(scope, tx);
          const keyNumber = await this.repo.nextKeyNumber(scope, tx);

          return this.repo.create(
            {
              ...input,
              workspaceId: actor.workspaceId,
              id: uuidv7(),
              itemKey: `${KEY_PREFIX[input.type]}-${keyNumber}`,
              // New items append to the end of their scope. A degenerate '' rank sorts
              // correctly once but corrupts later `between()` math.
              rank: between(maxRank, null),
            },
            tx,
          );
        });
        break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (!created) throw lastErr;
    // `logSafe`: a history entry must never fail the write that produced it.
    await this.activity.logSafe([
      this.activity.build(this.subject(created), actor.sub, 'portfolio_item.created', null),
    ]);
    return this.getItem(actor, created.id);
  }

  async updateItem(
    actor: JwtPayload,
    id: string,
    input: UpdatePortfolioItemInput,
  ): Promise<PortfolioItemWithProgress> {
    const existing = await this.requireItem(actor, id);
    await this.access.assertProjectPermission(actor, existing.projectId, 'portfolio:edit');

    // A project move is authorised in BOTH directions: taking work out of a project and
    // putting work into one are each an edit of that project's portfolio, and a Project
    // Admin may manage only their own (SRS §3.2). Checking only the source would let
    // someone push items into a project they cannot otherwise touch.
    const patch = { ...input };
    if (patch.projectId !== undefined && patch.projectId !== existing.projectId) {
      await this.access.assertProjectPermission(actor, patch.projectId, 'portfolio:edit');
      await this.applyProjectMove(actor.workspaceId, existing, patch);
    }

    // Validated against the EXISTING type: `type` is immutable, so an Epic can never
    // acquire a parent/team/release by editing.
    this.assertShape(existing.type, patch);
    // References are checked against the DESTINATION project — that is the scope the row
    // will live in once this write lands.
    await this.assertReferences(
      actor.workspaceId,
      patch.projectId ?? existing.projectId,
      patch,
      id,
    );

    // Milestones live in their own link table, so they are NOT a column patch — pull them
    // out before `repo.update` sees them, and write them separately.
    //
    // Scoped to the DESTINATION project, like every other reference on this write: SRS §5.1
    // limits the selector to "the Feature's Project plus any already-selected Milestones", so
    // a milestone from another project must be refused rather than silently dropped.
    const { milestoneIds, ...columns } = patch;
    if (milestoneIds !== undefined) {
      const projectId = patch.projectId ?? existing.projectId;
      const inProject = await this.repo.filterMilestonesInProject(
        milestoneIds,
        projectId,
        actor.workspaceId,
      );
      if (inProject.length !== milestoneIds.length) {
        throw new PreconditionFailedException(
          'MILESTONE_PROJECT_MISMATCH',
          'Every Milestone must belong to this item\u2019s Project',
        );
      }
    }

    await this.repo.update(id, columns, actor.workspaceId);
    if (milestoneIds !== undefined) await this.repo.setMilestones(id, milestoneIds);
    await this.activity.logSafe(
      this.activity.buildDiff(
        this.subject(existing),
        actor.sub,
        existing as unknown as Record<string, unknown>,
        patch,
        PORTFOLIO_ACTIVITY_CONFIG,
        'portfolio_item.updated',
      ),
    );
    return this.getItem(actor, id);
  }

  /**
   * Reconcile the references a project move invalidates, mutating `patch` in place.
   *
   * `project_id` is the scope for three other columns, none of which carries a foreign
   * key, so moving the row without touching them would leave links pointing into the OLD
   * project — a Release column showing another project's release, a Team that is not
   * linked to the new project. `PHASE5_DEV_HANDOFF.md` is explicit: "Changing Project must
   * clear an invalid cross-Project Epic/Feature relationship rather than preserve bad
   * data", and cross-project Epic/Feature/Release assignment is rejected outright.
   *
   * The rules come from SRS §3.1 and the Feature Detail spec:
   *   • **Team** — reset to a team linked to the NEW project, or cleared when it has
   *     none. Not merely cleared: the spec says a Feature's Project change "resets Team to
   *     a valid Team in the new Project".
   *   • **Release** — cleared unless the caller supplied one, because releases are
   *     per-project (`uq_releases_key` is on project).
   *   • **Parent Epic** — cleared when the Epic lives in a different project. Note this is
   *     narrower than it looks: Rally allows a parent and child to sit in different
   *     projects, but THIS product rejects cross-project Epic/Feature links, so the link
   *     cannot survive the move.
   *
   * An explicit value in the same request always wins — a caller moving a Feature and
   * naming its new Team in one PATCH gets the Team they asked for, and `assertReferences`
   * then proves it belongs to the destination.
   *
   * Deliberately does NOT touch child Features when an Epic moves: "Epic remains
   * Project-level and changing its Project does not move child Features" (SRS §3.1).
   */
  private async applyProjectMove(
    workspaceId: string,
    existing: PortfolioItem,
    patch: UpdatePortfolioItemInput,
  ): Promise<void> {
    const destination = patch.projectId as string;

    /**
     * REFUSED while the Feature is allocated on a capacity plan, naming the plans.
     *
     * A plan belongs to one project, so a Feature that leaves takes nothing with it: the allocation
     * rows stayed behind, `listAllocations` filtered on `plan_id` alone so they kept rendering and
     * kept feeding the team's Estimated, the plan total and the cutline — for a Feature no longer in
     * the plan's project. Publishing then wrote the OLD project's Release onto it, producing exactly
     * the state `assertReferences` rejects (`PORTFOLIO_ITEM_PROJECT_MISMATCH`). Nothing enforced it:
     * not the service, not the database.
     *
     * Refused rather than silently repaired, following `RELEASE_HAS_CAPACITY_PLAN` on release delete.
     * The alternative — deleting the rows — destroys a planner's committed numbers on a plan the
     * person moving the Feature may not even be able to see. Removing the Feature from the plan first
     * is one deliberate action, and the message says which plan to look at.
     */
    const planned = await this.db
      .selectDistinct({ planKey: capacityPlans.planKey, name: capacityPlans.name })
      .from(capacityPlanAllocations)
      .innerJoin(capacityPlans, eq(capacityPlans.id, capacityPlanAllocations.planId))
      .where(
        and(
          eq(capacityPlanAllocations.portfolioItemId, existing.id),
          eq(capacityPlans.workspaceId, workspaceId),
        ),
      )
      // `id` breaks the tie: `plan_key` is unique per project, not per workspace, and the
      // ordering ratchet requires the last column to be unique so two runs cannot disagree.
      .orderBy(capacityPlans.planKey, capacityPlans.id)
      .limit(3);
    if (planned.length > 0) {
      const named = planned.map((row) => `${row.planKey} (${row.name})`).join(', ');
      throw new PreconditionFailedException(
        'PORTFOLIO_ITEM_HAS_CAPACITY_ALLOCATION',
        `This Feature is allocated on ${named} — remove it from the plan before moving it to another project`,
      );
    }

    if (patch.teamId === undefined && existing.teamId !== null) {
      const [firstTeam] = await this.db
        .select({ id: teams.id })
        .from(teams)
        .innerJoin(projectTeams, eq(projectTeams.teamId, teams.id))
        .where(
          and(
            eq(teams.workspaceId, workspaceId),
            eq(projectTeams.projectId, destination),
            // Both the TEAM and its LINK must be live: an unlinked team is not a legal
            // assignment in the destination even if the team itself is active.
            eq(projectTeams.status, 'active'),
            eq(teams.status, 'active'),
          ),
        )
        // `id` breaks the tie: two teams may share a name, and without it "the new
        // project's first Team" would come back in physical-tuple order — a different
        // answer after the next UPDATE. Pinned by `query-ordering.ratchet.spec.ts`.
        .orderBy(teams.name, teams.id)
        .limit(1);
      patch.teamId = firstTeam?.id ?? null;
    }

    if (patch.releaseId === undefined && existing.releaseId !== null) {
      patch.releaseId = null;
    }

    if (patch.parentId === undefined && existing.parentId !== null) {
      const [parent] = await this.repo.findByIds([existing.parentId], workspaceId);
      if (!parent || parent.projectId !== destination) patch.parentId = null;
    }

    // Milestones follow REAL RALLY's rule, which is a conditional keep rather than a clear:
    // "If you move a work item to a new project after associating it with a milestone, the work
    // item will keep existing milestone(s) only if they exist in the new project."
    // (TechDocs, Managing Milestones.) So survivors stay assigned and the rest are dropped.
    //
    // Without this the row lands in a state its OWN write path would reject — the assignment
    // would still point at the source project's milestone, and the next save of any field would
    // fail `MILESTONE_PROJECT_MISMATCH`. The BA docs are silent here; Rally is not.
    if (patch.milestoneIds === undefined) {
      const current = await this.repo.listMilestones(existing.id, workspaceId);
      if (current.length > 0) {
        const surviving = await this.repo.filterMilestonesInProject(
          current.map((m) => m.id),
          destination,
          workspaceId,
        );
        if (surviving.length !== current.length) patch.milestoneIds = surviving;
      }
    }
  }

  /**
   * Archive (soft delete) or restore.
   *
   * An Epic with ACTIVE child Features is refused. Archiving it would leave those
   * Features pointing at a hidden parent: they would still appear in the Feature list
   * with an Epic column referencing something the user can no longer open, and the
   * Epic's rollup would keep aggregating through them.
   */
  async setArchived(
    actor: JwtPayload,
    id: string,
    archived: boolean,
  ): Promise<PortfolioItemWithProgress> {
    const existing = await this.requireItem(actor, id);
    await this.access.assertProjectPermission(actor, existing.projectId, 'portfolio:archive');

    if (archived && existing.type === 'epic') {
      const children = await this.repo.countActiveChildFeatures(id, actor.workspaceId);
      if (children > 0) {
        throw new PreconditionFailedException(
          'PORTFOLIO_EPIC_HAS_ACTIVE_FEATURES',
          `Archive or move the ${children} active Feature(s) under this Epic first`,
        );
      }
    }

    await this.repo.setArchived(id, archived, actor.workspaceId);
    return this.getItem(actor, id);
  }

  /**
   * Move one item between two neighbours by deriving a LexoRank strictly between their
   * ranks — a single-row UPDATE, never a renumbering pass.
   *
   * `beforeId`/`afterId` are the rows immediately ABOVE and BELOW the drop position in
   * ascending rank order; either is null at a list edge. Both null would mean "between
   * nothing and nothing", which `between()` answers with a mid-range rank that has no
   * relation to the list — so the caller must name at least one neighbour.
   *
   * Every neighbour must share this item's RANK SCOPE, which for portfolio items is
   * (workspace, type) rather than (project, parent): the list is cross-project and flat
   * per type. Accepting an Epic as a Feature's neighbour would interleave two independent
   * orderings and make the next drag throw.
   *
   * Deliberately does NOT take the advisory lock that `createItem` uses. This is a
   * read-modify-write too, but the value written is derived from two SPECIFIC neighbours
   * the client already sees, not from a shared MAX — so two concurrent drags can only
   * collide by targeting the identical gap, and the loser lands on an equal rank rather
   * than corrupting the scope. `between()` rejects the stale-neighbour case below, which
   * is the failure that actually matters.
   */
  async rankItem(
    actor: JwtPayload,
    id: string,
    opts: { beforeId?: string | null; afterId?: string | null },
  ): Promise<PortfolioItemWithProgress> {
    const item = await this.requireItem(actor, id);
    await this.access.assertProjectPermission(actor, item.projectId, 'portfolio:edit');

    if (!opts.beforeId && !opts.afterId) {
      throw new PreconditionFailedException(
        'PORTFOLIO_ITEM_RANK_CONFLICT',
        'A move needs at least one neighbour',
      );
    }

    const neighbourIds = [opts.beforeId, opts.afterId].filter(
      (n): n is string => typeof n === 'string',
    );
    if (neighbourIds.includes(id)) {
      throw new PreconditionFailedException(
        'PORTFOLIO_ITEM_RANK_CONFLICT',
        'An item cannot be its own neighbour',
      );
    }

    const neighbours = await this.repo.findByIds(neighbourIds, actor.workspaceId);
    const byId = new Map(neighbours.map((n) => [n.id, n]));

    const rankOf = (nid: string | null | undefined): string | null => {
      if (!nid) return null;
      const n = byId.get(nid);
      // Same type = same rank scope. A missing row is the same class of problem as a
      // wrong-scope one: the client is working from an order that no longer exists.
      if (!n || n.type !== item.type) {
        throw new PreconditionFailedException(
          'PORTFOLIO_ITEM_RANK_CONFLICT',
          'Neighbour is not in the same portfolio order; refresh and retry',
        );
      }
      return n.rank;
    };

    const lowRank = rankOf(opts.beforeId);
    const highRank = rankOf(opts.afterId);

    let rank: string;
    try {
      rank = between(lowRank, highRank);
    } catch {
      // Neighbours out of order — the client's view is stale. Refuse rather than write a
      // rank that would sort the row somewhere neither neighbour implies.
      throw new PreconditionFailedException(
        'PORTFOLIO_ITEM_RANK_CONFLICT',
        'Portfolio order changed; refresh and retry',
      );
    }

    await this.repo.update(id, { rank }, actor.workspaceId);
    return this.getItem(actor, id);
  }

  private async requireItem(actor: JwtPayload, id: string): Promise<PortfolioItem> {
    const item = await this.repo.findById(id, actor.workspaceId);
    if (!item) {
      throw new NotFoundException('PORTFOLIO_ITEM_NOT_FOUND', 'Portfolio item not found');
    }
    return item;
  }

  /**
   * Reject Epic-illegal fields with a clear error before the DB CHECK does.
   *
   * `ck_portfolio_epic_shape` already guarantees this, but a raw constraint violation
   * surfaces as a 500 with a Postgres message. Callers get a 422 naming the field.
   */
  private assertShape(
    type: PortfolioItemType,
    input: Pick<UpdatePortfolioItemInput, 'parentId' | 'teamId' | 'releaseId'>,
  ): void {
    if (type !== 'epic') return;
    const offending = (['parentId', 'teamId', 'releaseId'] as const).filter(
      (f) => input[f] !== undefined && input[f] !== null,
    );
    if (offending.length > 0) {
      throw new PreconditionFailedException(
        'PORTFOLIO_ITEM_INVALID_TYPE',
        `An Epic cannot have ${offending.join(', ')} — those belong to a Feature`,
      );
    }
  }

  /**
   * Verify every id the caller supplied actually resolves.
   *
   * None of `parent_id`, `team_id` or `release_id` carries a database foreign key, so an
   * unchecked bogus uuid would persist happily and then render as an empty Epic/Team/
   * Release column — indistinguishable from "not set", and impossible to explain later.
   */
  private async assertReferences(
    workspaceId: string,
    projectId: string,
    input: Pick<UpdatePortfolioItemInput, 'parentId' | 'teamId' | 'releaseId'>,
    selfId?: string,
  ): Promise<void> {
    if (input.parentId) {
      if (selfId && input.parentId === selfId) {
        // `ck_portfolio_no_self_parent` also covers this; named error beats a 500.
        throw new PreconditionFailedException(
          'PORTFOLIO_ITEM_INVALID_PARENT',
          'An item cannot be its own Epic',
        );
      }
      const [parent] = await this.repo.findByIds([input.parentId], workspaceId);
      if (!parent) {
        // 422 rather than 404: the missing thing is a field the caller sent, not the
        // resource they addressed, so the failure belongs to the request body.
        throw new PreconditionFailedException(
          'PORTFOLIO_ITEM_INVALID_PARENT',
          'Parent Epic not found',
        );
      }
      if (parent.type !== 'epic') {
        throw new PreconditionFailedException(
          'PORTFOLIO_ITEM_INVALID_PARENT',
          'A Feature’s parent must be an Epic',
        );
      }
      if (parent.archivedAt !== null) {
        throw new PreconditionFailedException(
          'PORTFOLIO_ITEM_INVALID_PARENT',
          'Cannot attach a Feature to an archived Epic',
        );
      }
    }

    if (input.releaseId) {
      // Releases are per-project (`uq_releases_key` is on project), so a release from
      // another project would put the Release column out of step with the row's project.
      const rows = await this.db
        .select({ id: releases.id })
        .from(releases)
        .where(
          and(
            eq(releases.id, input.releaseId),
            eq(releases.workspaceId, workspaceId),
            eq(releases.projectId, projectId),
          ),
        )
        .limit(1);
      if (rows.length === 0) {
        throw new PreconditionFailedException(
          'PORTFOLIO_ITEM_PROJECT_MISMATCH',
          'Release not found in this project',
        );
      }
    }

    if (input.teamId) {
      const rows = await this.db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.id, input.teamId), eq(teams.workspaceId, workspaceId)))
        .limit(1);
      if (rows.length === 0) {
        throw new PreconditionFailedException('PORTFOLIO_ITEM_TEAM_MISMATCH', 'Team not found');
      }
    }
  }

  /**
   * Turn one item's rollup into the four indicators.
   *
   * The Preliminary Estimate fallback comes from WORKSPACE SETTINGS, never a code
   * constant: the BA spec calls the seeded values temporary and defers the real scale
   * to Settings > Workspace > Project Management, and Rally makes the equivalent
   * mapping a workspace-admin setting.
   */
  private withProgress(
    item: PortfolioItemView,
    map: PreliminaryEstimateMap,
    /**
     * Injected so the verdict is deterministic per request rather than shifting between
     * rows of the same page, and so tests can pin a date instead of mocking the clock.
     */
    today: Date = new Date(),
  ): PortfolioItemWithProgress {
    const size = map[item.preliminaryEstimate] ?? { points: 0, count: 0 };
    return {
      ...item,
      // Health measures ACCEPTED work against the planned window, so it uses the accepted
      // rollup — not the completed one. That is the same D1 distinction the two Percent
      // Done indicators rest on: signed-off, not merely finished.
      health: computeHealth({
        accepted: item.rollup.acceptedPoints,
        total: item.rollup.rollupPoints,
        start: item.plannedStartDate === null ? null : new Date(item.plannedStartDate),
        end: item.plannedEndDate === null ? null : new Date(item.plannedEndDate),
        today,
        thresholds: PORTFOLIO_HEALTH_THRESHOLDS,
      }),
      progress: computePortfolioProgress(item.rollup, {
        refinedPoints: Number(item.refinedEstimate),
        refinedCount: item.refinedItemCountEstimate,
        preliminaryPoints: size.points,
        preliminaryCount: size.count,
      }),
    };
  }

  /** Delegates to the shared reader so portfolio and capacity cannot disagree on sizes. */
  private estimateMap(workspaceId: string): Promise<PreliminaryEstimateMap> {
    return this.estimateMaps.forWorkspace(workspaceId);
  }
}
