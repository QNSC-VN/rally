import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ISO_DATE, PageQuerySchema } from '@platform';
import {
  portfolioItemTypeEnum,
  portfolioItemStateEnum,
  preliminaryEstimateSizeEnum,
} from '../../../../../../../db/schema/enums';

// Derived from the DB enums rather than re-listed, so a schema change cannot leave the
// API accepting a value the column rejects (or vice versa).
const PORTFOLIO_ITEM_TYPES = portfolioItemTypeEnum.enumValues;
const PORTFOLIO_ITEM_STATES = portfolioItemStateEnum.enumValues;
const PRELIMINARY_SIZES = preliminaryEstimateSizeEnum.enumValues;

export const PortfolioListQuerySchema = PageQuerySchema.extend({
  /**
   * REQUIRED. The spec's Type selector has exactly two choices and no combined "All",
   * so there is no sensible default — a caller that omits it is asking the wrong
   * question rather than asking for everything.
   */
  type: z.enum(PORTFOLIO_ITEM_TYPES),
  projectId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  search: z.string().max(255).trim().optional(),
  /** Archived items are hidden by default; the list has no Active/Archived selector. */
  includeArchived: z.coerce.boolean().optional(),
});
export class PortfolioListQueryDto extends createZodDto(PortfolioListQuerySchema) {}

export const PortfolioChildrenQuerySchema = PageQuerySchema.extend({
  search: z.string().max(255).trim().optional(),
});
export class PortfolioChildrenQueryDto extends createZodDto(PortfolioChildrenQuerySchema) {}

// Exported so the enum-derived unions have one home.
export const PORTFOLIO_ENUMS = {
  types: PORTFOLIO_ITEM_TYPES,
  states: PORTFOLIO_ITEM_STATES,
  sizes: PRELIMINARY_SIZES,
} as const;

/**
 * Fields common to create and update.
 *
 * The three Feature-only ids are accepted on BOTH shapes rather than being split into
 * separate Epic/Feature schemas: the service rejects them for an Epic with a named
 * error, and duplicating the schema per type would mean two places to keep in step
 * with the DB CHECK.
 */
const portfolioWritableFields = {
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(20000).nullable(),
  state: z.enum(PORTFOLIO_ITEM_STATES),
  preliminaryEstimate: z.enum(PRELIMINARY_SIZES),
  /**
   * Top-down forecasts. NON-NEGATIVE and never null — 0 IS the "not forecast" value.
   *
   * Real Rally shows these as 0 rather than blank and accepts a typed 0; Broadcom
   * documents no rule either way. So 0 is the absent state (migration 0079) and the tier
   * chain already reads it that way: "Refined Estimate = Feature.refinedEstimate |
   * refinedWorkItemCountEstimate -> if > 0" (Capacity Planning SRS), so 0 falls through to
   * the Preliminary Estimate mapping exactly as a blank used to.
   *
   * Not `.nullable()`: with a NOT NULL column there is nothing for null to mean, and
   * accepting it would just be a second spelling of 0. Send 0 to clear a forecast.
   */
  refinedEstimate: z.number().nonnegative(),
  refinedItemCountEstimate: z.number().int().nonnegative(),
  parentId: z.string().uuid().nullable(),
  teamId: z.string().uuid().nullable(),
  releaseId: z.string().uuid().nullable(),
  ownerId: z.string().uuid().nullable(),
  plannedStartDate: ISO_DATE.nullable(),
  plannedEndDate: ISO_DATE.nullable(),
  marketReleaseDate: ISO_DATE.nullable(),
};

export const CreatePortfolioItemSchema = z.object({
  projectId: z.string().uuid(),
  /** Immutable after create — an Epic cannot become a Feature (see the update schema). */
  type: z.enum(PORTFOLIO_ITEM_TYPES),
  name: portfolioWritableFields.name,
  description: portfolioWritableFields.description.optional(),
  state: portfolioWritableFields.state.optional(),
  preliminaryEstimate: portfolioWritableFields.preliminaryEstimate.optional(),
  refinedEstimate: portfolioWritableFields.refinedEstimate.optional(),
  refinedItemCountEstimate: portfolioWritableFields.refinedItemCountEstimate.optional(),
  parentId: portfolioWritableFields.parentId.optional(),
  teamId: portfolioWritableFields.teamId.optional(),
  releaseId: portfolioWritableFields.releaseId.optional(),
  ownerId: portfolioWritableFields.ownerId.optional(),
  plannedStartDate: portfolioWritableFields.plannedStartDate.optional(),
  plannedEndDate: portfolioWritableFields.plannedEndDate.optional(),
  marketReleaseDate: portfolioWritableFields.marketReleaseDate.optional(),
});
export class CreatePortfolioItemDto extends createZodDto(CreatePortfolioItemSchema) {}

/**
 * Every field optional: omitted means "leave alone", explicit `null` means "clear".
 *
 * `type` is absent deliberately: changing it would have to re-key the item, move its
 * child links and re-rank it into the other scope. Rally does not offer that.
 *
 * `projectId` IS writable, and used to be excluded on the incorrect grounds that "Rally
 * offers neither". Rally offers this one — Broadcom's project-hierarchy guide says
 * "Rally recommends you update the project field to reflect which team is handling the
 * work", since a portfolio item starts in a strategy project and moves to an execution
 * project once a team picks it up. The BA spec requires it too (SRS §3.1 `Project | Yes`,
 * FR-004: Project is inline-editable for both Epic and Feature).
 *
 * The move is not a plain field write — see `applyProjectMove` in the service for the
 * three cross-project references it has to reconcile.
 */
export const UpdatePortfolioItemSchema = z
  .object({
    name: portfolioWritableFields.name.optional(),
    description: portfolioWritableFields.description.optional(),
    /** Move the item to another project. Never nullable — an item always has a project. */
    projectId: z.string().uuid().optional(),
    state: portfolioWritableFields.state.optional(),
    preliminaryEstimate: portfolioWritableFields.preliminaryEstimate.optional(),
    refinedEstimate: portfolioWritableFields.refinedEstimate.optional(),
    refinedItemCountEstimate: portfolioWritableFields.refinedItemCountEstimate.optional(),
    parentId: portfolioWritableFields.parentId.optional(),
    teamId: portfolioWritableFields.teamId.optional(),
    releaseId: portfolioWritableFields.releaseId.optional(),
    ownerId: portfolioWritableFields.ownerId.optional(),
    plannedStartDate: portfolioWritableFields.plannedStartDate.optional(),
    plannedEndDate: portfolioWritableFields.plannedEndDate.optional(),
    marketReleaseDate: portfolioWritableFields.marketReleaseDate.optional(),
  })
  // An empty body would otherwise bump `updated_at` and return 200 having changed
  // nothing, which reads as a successful save in the UI.
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export class UpdatePortfolioItemDto extends createZodDto(UpdatePortfolioItemSchema) {}

/**
 * Move an item between two neighbours.
 *
 * Both are optional because either can be a list edge, but the service rejects a body
 * with NEITHER: "between nothing and nothing" has no meaning in a rank order, and
 * `between(null, null)` would silently return a mid-range rank unrelated to the list.
 */
export const RankPortfolioItemSchema = z.object({
  /** The item immediately ABOVE the drop position (lower rank). Null at the top. */
  beforeId: z.string().uuid().nullable().optional(),
  /** The item immediately BELOW the drop position (higher rank). Null at the bottom. */
  afterId: z.string().uuid().nullable().optional(),
});
export class RankPortfolioItemDto extends createZodDto(RankPortfolioItemSchema) {}
