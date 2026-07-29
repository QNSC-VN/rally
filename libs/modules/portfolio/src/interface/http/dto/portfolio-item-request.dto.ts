import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';
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

// Exported for slice 3 (write paths) so the enum-derived unions have one home.
export const PORTFOLIO_ENUMS = {
  types: PORTFOLIO_ITEM_TYPES,
  states: PORTFOLIO_ITEM_STATES,
  sizes: PRELIMINARY_SIZES,
} as const;
