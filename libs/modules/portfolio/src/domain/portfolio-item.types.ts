import type {
  PortfolioItemState,
  PortfolioItemType,
  PreliminaryEstimateSize,
} from '../../../../../db/schema/enums';

/**
 * A portfolio item — an Epic or a Feature.
 *
 * ONE type for both, mirroring the single `work.portfolio_items` table. The BA spec
 * gives them one list, one state enum, one create template and one archive rule; the
 * differences are three nullable fields and which rollup applies. The DB CHECK
 * constraints (`ck_portfolio_epic_shape`) are what hold the two shapes apart:
 *
 *   epic    → parentId, teamId, releaseId are ALL null
 *   feature → may carry parentId (its Epic), teamId and releaseId
 *
 * Numeric DB columns arrive as STRINGS (Drizzle preserves numeric precision), so
 * `refinedEstimate` is a string while `refinedItemCountEstimate` is an integer.
 * Converting happens at the DTO boundary, not here.
 */
export interface PortfolioItem {
  id: string;
  workspaceId: string;
  projectId: string;
  /** `EP-101` / `FE-318`. Per-project sequence. */
  itemKey: string;
  type: PortfolioItemType;
  name: string;
  description: string | null;
  state: PortfolioItemState;
  preliminaryEstimate: PreliminaryEstimateSize;
  /** Top-down points forecast. Feeds Estimated Progress only, never Percent Done. */
  refinedEstimate: string | null;
  /** Top-down child-count forecast. */
  refinedItemCountEstimate: number | null;
  /** Feature → Epic. Always null for an Epic. */
  parentId: string | null;
  /** Feature only. */
  teamId: string | null;
  /** Feature only — Rally allows Release on the lowest portfolio level only. */
  releaseId: string | null;
  ownerId: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  marketReleaseDate: string | null;
  rank: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregated child facts for one portfolio item, produced by ONE SQL query per list
 * page — never per row.
 *
 * Note the two different "done" definitions, both deliberate and both already
 * modelled in `db/schema/enums.ts`:
 *   • `accepted*` uses ACCEPTED_SCHEDULE_STATES  (accepted, release)
 *   • `completed*` uses COMPLETED_SCHEDULE_STATES (completed, accepted, release)
 * Portfolio Percent Done reports what the business has SIGNED OFF; a capacity plan's
 * Complete reports what the team has FINISHED. Do not collapse them.
 */
export interface PortfolioRollupRow {
  portfolioItemId: string;
  rollupPoints: number;
  rollupCount: number;
  acceptedPoints: number;
  acceptedCount: number;
  completedPoints: number;
  completedCount: number;
}

/** A portfolio item plus everything the list and detail surfaces render. */
export interface PortfolioItemView extends PortfolioItem {
  ownerName: string | null;
  teamName: string | null;
  releaseName: string | null;
  /** Parent Epic's key, for the Feature row's context. Null for an Epic. */
  parentKey: string | null;
  rollup: PortfolioRollupRow;
  /** Count of active child Features. Epic only; 0 for a Feature. */
  childFeatureCount: number;
}

/** What a CALLER may ask for. Deliberately carries no authorization field. */
export interface PortfolioListRequest {
  /** Epic or Feature — the spec's Type selector has no combined "All". */
  type: PortfolioItemType;
  projectId?: string;
  teamId?: string;
  search?: string;
  /** Archived items are hidden by default; the list has no Active/Archived selector. */
  includeArchived?: boolean;
}

/**
 * What the REPOSITORY executes: a caller's request plus the authorization filter the
 * service resolves.
 *
 * Split from `PortfolioListRequest` on purpose. `readableProjectIds` is required and
 * non-optional here, so a caller cannot construct a repository filter without deciding
 * it, and a controller cannot supply its own. Making it optional would mean a forgotten
 * field silently lists every project.
 *
 * `null` = unrestricted (a workspace-wide grant). `[]` = nothing readable; the service
 * short-circuits that case before reaching SQL.
 */
export interface PortfolioListFilter extends PortfolioListRequest {
  readableProjectIds: string[] | null;
}
