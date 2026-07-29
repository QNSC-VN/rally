import type { CursorPayload, PagedResult } from '@platform';
import type {
  PortfolioItem,
  PortfolioItemView,
  PortfolioListFilter,
  PortfolioRollupRow,
} from '../portfolio-item.types';

export const PORTFOLIO_ITEM_REPOSITORY = Symbol('PORTFOLIO_ITEM_REPOSITORY');

export interface IPortfolioItemRepository {
  findById(id: string, workspaceId: string): Promise<PortfolioItem | null>;

  /** Detail surface: the item plus names, parent key and rollups. */
  findViewById(id: string, workspaceId: string): Promise<PortfolioItemView | null>;

  /**
   * The list surface, ordered by rank.
   *
   * Returns rollups already joined — one aggregate for the whole page, not one query
   * per row. A 50-row page rendering four progress indicators each must not become
   * 200 queries.
   */
  listByFilter(
    workspaceId: string,
    filter: PortfolioListFilter,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<PortfolioItemView>>;

  /**
   * Rollups for specific items, for callers that already hold the rows (the Epic
   * children preview, and capacity planning in a later slice).
   */
  rollupsFor(ids: string[], workspaceId: string): Promise<PortfolioRollupRow[]>;

  /** Linked Story/Defect for the Children tab. */
  listChildren(
    featureId: string,
    workspaceId: string,
    args: { limit: number; cursor: CursorPayload | null; search?: string },
  ): Promise<PagedResult<PortfolioChildItem>>;

  /** Active child Features of an Epic, for the list preview and the Children tab. */
  listChildFeatures(epicId: string, workspaceId: string): Promise<PortfolioItemView[]>;
}

/** A linked Story/Defect as the Children tab renders it. */
export interface PortfolioChildItem {
  id: string;
  itemKey: string;
  type: 'story' | 'defect';
  title: string;
  scheduleState: string;
  storyPoints: string | null;
  releaseName: string | null;
  projectName: string | null;
  teamName: string | null;
  ownerName: string | null;
}
