import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  portfolioItemTypeEnum,
  portfolioItemStateEnum,
  preliminaryEstimateSizeEnum,
} from '../../../../../../../db/schema/enums';

const TYPES = portfolioItemTypeEnum.enumValues;
const STATES = portfolioItemStateEnum.enumValues;
const SIZES = preliminaryEstimateSizeEnum.enumValues;

/**
 * The four read-only indicators.
 *
 * Each is `null` when its denominator is zero, NOT 0. "No work linked" and "none of the
 * work is done" both render as an empty meter, but only the first is a data-entry gap —
 * the client needs to tell them apart to warn about missing estimates the way Rally's
 * hover callout does.
 */
const ProgressSchema = z.object({
  percentDoneByPlanEstimate: z
    .number()
    .nullable()
    .describe('Accepted points / all linked points. Null when nothing is linked.'),
  percentDoneByCount: z
    .number()
    .nullable()
    .describe('Accepted item count / all linked count. Null when nothing is linked.'),
  estimatedProgressByPoints: z
    .number()
    .nullable()
    .describe('Accepted points / refined-or-preliminary points forecast. May exceed 1.'),
  estimatedProgressByCount: z
    .number()
    .nullable()
    .describe('Accepted count / refined-or-preliminary count forecast. May exceed 1.'),
});

/** Raw child aggregates, so a client can show the underlying numbers beside the bars. */
const RollupSchema = z.object({
  rollupPoints: z.number(),
  rollupCount: z.number(),
  acceptedPoints: z.number().describe('ACCEPTED_SCHEDULE_STATES: accepted, release'),
  acceptedCount: z.number(),
  completedPoints: z
    .number()
    .describe(
      'COMPLETED_SCHEDULE_STATES: completed, accepted, release — capacity, not Percent Done',
    ),
  completedCount: z.number(),
});

const PortfolioItemSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  itemKey: z.string().describe('EP-101 or FE-318'),
  type: z.enum(TYPES),
  name: z.string(),
  description: z.string().nullable(),
  state: z.enum(STATES),
  preliminaryEstimate: z.enum(SIZES),
  refinedEstimate: z.number().nullable().describe('Top-down points forecast'),
  refinedItemCountEstimate: z.number().nullable().describe('Top-down child-count forecast'),
  parentId: z.string().uuid().nullable().describe('Feature → Epic. Always null for an Epic.'),
  parentKey: z.string().nullable(),
  teamId: z.string().uuid().nullable().describe('Feature only'),
  teamName: z.string().nullable(),
  releaseId: z.string().uuid().nullable().describe('Feature only'),
  releaseName: z.string().nullable(),
  ownerId: z.string().uuid().nullable(),
  ownerName: z.string().nullable(),
  plannedStartDate: z.string().nullable().describe('YYYY-MM-DD'),
  plannedEndDate: z.string().nullable().describe('YYYY-MM-DD'),
  marketReleaseDate: z.string().nullable().describe('YYYY-MM-DD'),
  rank: z.string(),
  // ISO strings, not z.date(): zod's toJSONSchema cannot represent a Date, so a
  // z.date() here makes Swagger generation throw "Date cannot be represented in JSON
  // Schema" and the whole app fails to boot. Matches every other response DTO.
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  childFeatureCount: z.number().describe('Active child Features. Epic only; 0 for a Feature.'),
  rollup: RollupSchema,
  progress: ProgressSchema,
});
export class PortfolioItemResponseDto extends createZodDto(PortfolioItemSchema) {}

/** A linked Story/Defect on the Children tab. */
const PortfolioChildSchema = z.object({
  id: z.string().uuid(),
  itemKey: z.string(),
  type: z.enum(['story', 'defect']),
  title: z.string(),
  scheduleState: z.string(),
  storyPoints: z.number().nullable(),
  releaseName: z.string().nullable(),
  projectName: z.string().nullable(),
  teamName: z.string().nullable(),
  ownerName: z.string().nullable(),
});
export class PortfolioChildResponseDto extends createZodDto(PortfolioChildSchema) {}
