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
import type { CursorPayload, JwtPayload, PagedResult } from '@platform';
import { workspaceSettings } from '../../../../../db/schema/workspace';
import { releases, teams } from '../../../../../db/schema/work';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_PRELIMINARY_ESTIMATE_MAP,
  type PreliminaryEstimateMap,
} from '../../../../../db/schema/enums';
import { computePortfolioProgress, type PortfolioProgress } from '../domain/portfolio-rollup';
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

/** A portfolio item with its four computed progress indicators. */
export interface PortfolioItemWithProgress extends PortfolioItemView {
  progress: PortfolioProgress;
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
  ) {}

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

    return {
      data: page.data.map((item) => this.withProgress(item, map)),
      pageInfo: page.pageInfo,
    };
  }

  async getItem(actor: JwtPayload, id: string): Promise<PortfolioItemWithProgress> {
    const item = await this.repo.findViewById(id, actor.workspaceId);
    if (!item) {
      throw new NotFoundException('PORTFOLIO_ITEM_NOT_FOUND', 'Portfolio item not found');
    }
    const map = await this.estimateMap(actor.workspaceId);
    return this.withProgress(item, map);
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
    return children.map((c) => this.withProgress(c, map));
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
    return this.getItem(actor, created.id);
  }

  async updateItem(
    actor: JwtPayload,
    id: string,
    input: UpdatePortfolioItemInput,
  ): Promise<PortfolioItemWithProgress> {
    const existing = await this.requireItem(actor, id);
    await this.access.assertProjectPermission(actor, existing.projectId, 'portfolio:edit');
    // Validated against the EXISTING type: `type` is immutable, so an Epic can never
    // acquire a parent/team/release by editing.
    this.assertShape(existing.type, input);
    await this.assertReferences(actor.workspaceId, existing.projectId, input, id);

    await this.repo.update(id, input, actor.workspaceId);
    return this.getItem(actor, id);
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
  ): PortfolioItemWithProgress {
    const size = map[item.preliminaryEstimate] ?? { points: 0, count: 0 };
    return {
      ...item,
      progress: computePortfolioProgress(item.rollup, {
        refinedPoints: item.refinedEstimate === null ? null : Number(item.refinedEstimate),
        refinedCount: item.refinedItemCountEstimate,
        preliminaryPoints: size.points,
        preliminaryCount: size.count,
      }),
    };
  }

  /**
   * The workspace's size→points/count mapping.
   *
   * Falls back to the seeded default when the row is missing or holds `{}` — a
   * workspace created before migration 0071, or one whose settings row was never
   * written. Returning an empty map instead would make every Estimated Progress
   * indicator null and look like a product bug.
   */
  private async estimateMap(workspaceId: string): Promise<PreliminaryEstimateMap> {
    const rows = await this.db
      .select({ map: workspaceSettings.preliminaryEstimateMap })
      .from(workspaceSettings)
      .where(and(eq(workspaceSettings.workspaceId, workspaceId)))
      .limit(1);

    const raw = rows[0]?.map as PreliminaryEstimateMap | undefined;
    if (!raw || Object.keys(raw).length === 0) return DEFAULT_PRELIMINARY_ESTIMATE_MAP;
    return { ...DEFAULT_PRELIMINARY_ESTIMATE_MAP, ...raw };
  }
}
