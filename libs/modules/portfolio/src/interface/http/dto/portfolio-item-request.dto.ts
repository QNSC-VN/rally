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

/**
 * The Feature picker's query. `projectId` is REQUIRED, which is what lets the route be gated by
 * the guard rather than narrowed in the service — see the route's own docblock. §5.3:133 scopes
 * the selectable list to the Work Item's Project, so there is no "all projects" form to ask for.
 *
 * Not a `PageQuerySchema` extension: a project's active Features are a bounded set a picker reads
 * whole, and a paged picker silently omits options past the first page.
 */
export const PortfolioFeatureOptionsQuerySchema = z.object({
  projectId: z.string().uuid(),
});
export class PortfolioFeatureOptionsQueryDto extends createZodDto(
  PortfolioFeatureOptionsQuerySchema,
) {}

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
  /** Rich text, same limit and nullability as a work item's (0080). */
  notes: z.string().max(20000).nullable(),
  releaseNotes: z.string().max(20000).nullable(),
  /** The BA's fourth rich-text block (SRS §5.1, §11.4) — same editor, same limit. */
  whatSuccessLooksLike: z.string().max(20000).nullable(),
  state: z.enum(PORTFOLIO_ITEM_STATES),
  preliminaryEstimate: z.enum(PRELIMINARY_SIZES),
  /**
   * Top-down forecasts. NON-NEGATIVE and never null — 0 IS the "not forecast" value.
   *
   * Real Rally shows these as 0 rather than blank and accepts a typed 0; Broadcom
   * documents no rule either way. So 0 is the absent state (migration 0081) and the tier
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
  notes: portfolioWritableFields.notes.optional(),
  releaseNotes: portfolioWritableFields.releaseNotes.optional(),
  whatSuccessLooksLike: portfolioWritableFields.whatSuccessLooksLike.optional(),
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
 * `projectId` IS ABSENT TOO, and this is a REVERSAL — recorded rather than deleted, because the
 * reasoning that put it here is still in Broadcom's docs and the next reader will find it.
 *
 * It was writable on two grounds. Broadcom's project-hierarchy guide says "Rally recommends you
 * update the project field to reflect which team is handling the work", and the BA's own §3.1 then
 * read `Project | Yes` with FR-004 listing it among the inline-editable fields — a contradiction
 * that commit `1dc027f3` deliberately left open pending a ruling. **The BA has now ruled the other
 * way, eleven places over** (`Phase 5/01_Portfolio_Items/SRS.md`): §45 "Inherited from the current
 * Project context at creation and read-only afterward for both Feature and Epic", §56, §66, §98,
 * §339, §360 and §387 all `Read-only`, FR-004 (§209) and AC-3 (§271) with Project struck from the
 * inline-editable set, and FR-023 (§229) / AC-24 (§293) extending the same rule to Work Items.
 *
 * So a Project is now fixed at creation. `applyProjectMove` — the reconciliation of Team, Release,
 * parent Epic and Milestones that a move needed, plus its `PORTFOLIO_ITEM_HAS_CAPACITY_ALLOCATION`
 * refusal — is GONE with the field, not kept behind it: with nothing able to reach `project_id`
 * through this schema, a guard on that path protects nothing and reads in review as a boundary that
 * is not one. `git log` has it if the BA reverses again.
 */
export const UpdatePortfolioItemSchema = z
  .object({
    name: portfolioWritableFields.name.optional(),
    description: portfolioWritableFields.description.optional(),
    notes: portfolioWritableFields.notes.optional(),
    releaseNotes: portfolioWritableFields.releaseNotes.optional(),
    whatSuccessLooksLike: portfolioWritableFields.whatSuccessLooksLike.optional(),
    state: portfolioWritableFields.state.optional(),
    preliminaryEstimate: portfolioWritableFields.preliminaryEstimate.optional(),
    refinedEstimate: portfolioWritableFields.refinedEstimate.optional(),
    refinedItemCountEstimate: portfolioWritableFields.refinedItemCountEstimate.optional(),
    parentId: portfolioWritableFields.parentId.optional(),
    teamId: portfolioWritableFields.teamId.optional(),
    releaseId: portfolioWritableFields.releaseId.optional(),
    ownerId: portfolioWritableFields.ownerId.optional(),
    /**
     * The COMPLETE Milestone set. Omit to leave assignments alone; `[]` clears them.
     *
     * A whole-set replace rather than add/remove verbs, because the rail's multi-select
     * always knows the full selection — two verbs would let the client and the row drift
     * apart when a checkbox click is lost.
     *
     * Scope is checked by `MilestonesService.assertArtifactsAssignable`, the SAME assertion
     * `PUT /milestones/:id/artifacts` and `PUT /work-items/:id/milestones` call — so this end of
     * the link can no longer accept or refuse anything the other two would not. It used to run a
     * private `filterMilestonesInProject`, which matched `milestones.project_id` alone: no
     * team-scope check at all, and no `milestone_projects` union, so a Feature in a Milestone's
     * SECOND in-scope project was refused `MILESTONE_PROJECT_MISMATCH` here and accepted there
     * (`Phase 3/03_Milestones/SRS.md:88`, FR-021/023, Q06).
     */
    milestoneIds: z.array(z.string().uuid()).optional(),
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
