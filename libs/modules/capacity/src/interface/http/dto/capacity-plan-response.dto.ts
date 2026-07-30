import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { capacityPlanStatusEnum, capacityPlanUnitEnum } from '../../../../../../../db/schema/enums';

const STATUSES = capacityPlanStatusEnum.enumValues;
const UNITS = capacityPlanUnitEnum.enumValues;

/**
 * The four numbers every capacity row shows, plus advisory warnings.
 *
 * `complete` uses COMPLETED_SCHEDULE_STATES while the Portfolio's Percent Done uses
 * ACCEPTED_SCHEDULE_STATES — the deliberate D1 distinction. `capacity` is null on a Feature
 * row (it has none of its own) and on a team that has not entered one.
 *
 * Rollup/Complete follow Rally: a child story counts only when its project AND release match
 * the plan, attributed to a team by the story's own team.
 */
const CapacityMetricsSchema = z.object({
  complete: z.number(),
  rollup: z.number(),
  estimated: z.number(),
  capacity: z.number().nullable(),
  // Ordered CAUSE-FIRST, and the client renders them in the order it receives: a missing
  // estimate or a missing capacity is why the comparison rules fired, so leading with the
  // consequence would send a planner to fix the wrong thing.
  warnings: z.array(
    z.enum([
      'feature_missing_estimate',
      'team_missing_capacity',
      'rollup_exceeds_estimated',
      'rollup_exceeds_capacity',
      'estimated_exceeds_capacity',
      'load_above_target',
    ]),
  ),
});

const CapacityAllocationSchema = z.object({
  id: z.string().uuid(),
  portfolioItemId: z.string().uuid(),
  itemKey: z.string(),
  name: z.string(),
  /** Null = the Unallocated bucket. */
  teamId: z.string().uuid().nullable(),
  value: z.number(),
  tier: z
    .enum(['allocated', 'refined', 'preliminary', 'none'])
    .describe('Which estimate tier the Feature figure came from — drives the UI badge'),
  metrics: CapacityMetricsSchema,
});

const CapacityPlanTeamSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  teamName: z.string().nullable(),
  /**
   * `null` means the planner has not entered a capacity yet — NOT zero capacity. The grid
   * renders blank, and no warning rule may treat it as a real ceiling.
   */
  capacity: z.number().nullable(),
  metrics: CapacityMetricsSchema,
});

export const CapacityPlanSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectName: z.string().nullable(),
  releaseId: z.string().uuid(),
  releaseName: z.string().nullable(),
  name: z.string(),
  status: z.enum(STATUSES),
  unit: z.enum(UNITS).describe('Fixed at creation — every number on the plan uses it'),
  plannedStartDate: z.string().nullable().describe('YYYY-MM-DD'),
  plannedEndDate: z.string().nullable().describe('YYYY-MM-DD'),
  targetLoadPct: z.number().int().describe('Advisory load ceiling, 1–99'),
  // `z.date()` cannot be converted by zod's JSON-Schema emitter, which breaks Swagger
  // generation and therefore app boot — these are ISO strings, as everywhere else.
  publishedAt: z.string().datetime().nullable(),
  publishedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  teams: z.array(CapacityPlanTeamSchema),
  /** Sum of the capacities ENTERED so far; null when none has been. */
  totalCapacity: z.number().nullable(),
  allocations: z.array(CapacityAllocationSchema),
  /**
   * Demand parked without a team.
   *
   * Reported separately and deliberately excluded from every team's Estimated: an
   * unallocated placeholder must not outrank a Refined or Preliminary forecast.
   */
  unallocated: z.number(),
});
export class CapacityPlanResponseDto extends createZodDto(CapacityPlanSchema) {}

/**
 * A capacity forecast for one team.
 *
 * Three numbers rather than one, because that is the answer: Rally reports the amount
 * delivered 85% of the time (Min), 50% (Median) and 15% (Max), and a planner choosing a
 * commitment needs the spread. A single number would hide whether the team is steady or
 * erratic — the whole reason the forecast samples history instead of averaging it.
 *
 * `insufficientData` is a REPORT, not an error: a new team with no finished iterations is a
 * normal state, and the dialog explains it rather than failing.
 */
const ForecastSchema = z.object({
  min: z.number().describe('Delivered 85% of the time — the conservative commitment'),
  median: z.number().describe('Delivered 50% of the time'),
  max: z.number().describe('Delivered 15% of the time — optimistic, not a target'),
  iterationsModelled: z.number().int().describe("Plan window ÷ the team's average cadence"),
  samplesUsed: z.number().int().describe('Finished iterations that fed the sampler'),
  historyDays: z.number().int().describe('Calendar days of history behind the forecast'),
  insufficientData: z.enum(['no_history', 'too_little_history', 'no_window']).nullable(),
});
export class CapacityForecastResponseDto extends createZodDto(ForecastSchema) {}
