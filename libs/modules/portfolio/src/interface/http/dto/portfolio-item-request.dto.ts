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
  /** Top-down points forecast. Non-negative — `ck_portfolio_refined_positive`. */
  refinedEstimate: z.number().nonnegative().nullable(),
  refinedItemCountEstimate: z.number().int().nonnegative().nullable(),
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
 * `type` and `projectId` are absent deliberately. Changing type would have to re-key the
 * item, move its child links and re-rank it into the other scope; moving project would
 * invalidate its Release (releases are per-project) and its rollup's project scope.
 * Rally offers neither.
 */
export const UpdatePortfolioItemSchema = z
  .object({
    name: portfolioWritableFields.name.optional(),
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
  })
  // An empty body would otherwise bump `updated_at` and return 200 having changed
  // nothing, which reads as a successful save in the UI.
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export class UpdatePortfolioItemDto extends createZodDto(UpdatePortfolioItemSchema) {}
