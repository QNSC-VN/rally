import type { CursorPayload, DbExecutor, PagedResult } from '@platform';
import type { WorkItemPriority } from '../../../../../../db/schema/enums';
import type {
  CreatePortfolioItemInput,
  PortfolioItem,
  PortfolioItemView,
  PortfolioListFilter,
  PortfolioRankScope,
  PortfolioRollupRow,
  UpdatePortfolioItemInput,
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

  /** Milestones assigned to this item, for the detail rail's multi-select. */
  listMilestones(id: string, workspaceId: string): Promise<{ id: string; name: string }[]>;

  /** Replaces this item's Milestone assignments wholesale, in one transaction. */
  setMilestones(id: string, milestoneIds: string[]): Promise<void>;

  /**
   * The subset of `milestoneIds` belonging to `projectId`. Serves both the write-time scope
   * check (compare lengths) and the project-move reconciliation (keep the survivors).
   */
  filterMilestonesInProject(
    milestoneIds: string[],
    projectId: string,
    workspaceId: string,
  ): Promise<string[]>;

  /**
   * The linked-leaf rollup split by child type, for the detail page's accepted-children
   * panel. Detail-only: it is one grouped query, deliberately kept off the list path where
   * the per-row scalar subqueries live.
   */
  childRollupByType(
    id: string,
    workspaceId: string,
  ): Promise<
    {
      type: 'story' | 'defect';
      points: number;
      count: number;
      acceptedPoints: number;
      acceptedCount: number;
    }[]
  >;

  /** Several items by id, for validating rank neighbours and parent references. */
  findByIds(ids: string[], workspaceId: string): Promise<PortfolioItem[]>;

  // ── Writes ─────────────────────────────────────────────────────────────────

  /**
   * Next number for `EP-<n>` / `FE-<n>`, scoped to (workspace, type).
   *
   * `MAX(existing) + 1`, which is NOT atomic under concurrent creates — the same
   * trade-off releases/iterations/milestones make. `uq_portfolio_item_key` is what
   * actually protects us, so the service retries once on a collision. The atomic
   * counter work items use is unavailable here: `workspace_item_counters.item_type`
   * is the `work_item_type` enum, which migration 0072 narrowed to story/task/defect.
   */
  nextKeyNumber(scope: PortfolioRankScope, executor?: DbExecutor): Promise<number>;

  /**
   * Take a transaction-scoped advisory lock on one (workspace, type) rank scope.
   *
   * Deriving a rank is a read-modify-write, so it is only safe when the read and the
   * insert are serialised against other creates in the same scope. Call this first,
   * then {@link findMaxRank} with the SAME executor. Without it two creates read the
   * same max, derive the SAME rank, and the next drag-reorder throws
   * LEXORANK_NEIGHBOURS_OUT_OF_ORDER on the equal neighbours — this already happened
   * to work items in 22 scopes.
   */
  lockRankScope(scope: PortfolioRankScope, executor: DbExecutor): Promise<void>;

  /** Highest rank in the scope, or null when empty. Used to append at the end. */
  findMaxRank(scope: PortfolioRankScope, executor?: DbExecutor): Promise<string | null>;

  create(
    input: CreatePortfolioItemInput & { id: string; itemKey: string; rank: string },
    executor?: DbExecutor,
  ): Promise<PortfolioItem>;

  update(
    id: string,
    input: UpdatePortfolioItemInput & { rank?: string },
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<PortfolioItem>;

  /** Archive or restore. Archiving is a soft delete — `archived_at`, never a DELETE. */
  setArchived(
    id: string,
    archived: boolean,
    workspaceId: string,
    executor?: DbExecutor,
  ): Promise<PortfolioItem>;

  /** Count of ACTIVE child Features, for the archive guard on an Epic. */
  countActiveChildFeatures(epicId: string, workspaceId: string): Promise<number>;
}

/** A linked Story/Defect as the Children tab renders it. */
export interface PortfolioChildItem {
  id: string;
  itemKey: string;
  type: 'story' | 'defect';
  title: string;
  scheduleState: string;
  storyPoints: string | null;
  /** The BA's `Priority` and `Iteration` columns on the Children tab. */
  priority: WorkItemPriority;
  iterationId: string | null;
  iterationName: string | null;
  /** The stored LexoRank — already this list's ORDER BY, and what drag-to-rank reorders. */
  rank: string;
  /** IDs as well as names, so a grid can bind an editable picker to the child. */
  projectId: string;
  releaseId: string | null;
  teamId: string | null;
  assigneeId: string | null;
  releaseName: string | null;
  projectName: string | null;
  teamName: string | null;
  ownerName: string | null;
}
