import { Inject, Injectable } from '@nestjs/common';
import { NotFoundException, PermissionDeniedException } from '@platform';
import { AccessService } from '@modules/access';
import type { CursorPayload, JwtPayload, PagedResult } from '@platform';
import { workspaceSettings } from '../../../../../db/schema/workspace';
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
import type { PortfolioItemView, PortfolioListRequest } from '../domain/portfolio-item.types';

/** A portfolio item with its four computed progress indicators. */
export interface PortfolioItemWithProgress extends PortfolioItemView {
  progress: PortfolioProgress;
}

@Injectable()
export class PortfolioItemsService {
  constructor(
    @Inject(PORTFOLIO_ITEM_REPOSITORY) private readonly repo: IPortfolioItemRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly access: AccessService,
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
      return {
        data: [],
        pageInfo: { nextCursor: null, hasNextPage: false, limit: args.limit },
      };
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
        return { data: [], pageInfo: { nextCursor: null, hasNextPage: false, limit: args.limit } };
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
