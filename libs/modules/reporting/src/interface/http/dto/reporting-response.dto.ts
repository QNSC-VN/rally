import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response schemas, declared with zod so `/api/docs-json` names them and the SPA's generated
 * client gets real types instead of `unknown`. The shapes mirror `domain/reporting.types.ts`
 * — the domain owns the contract, these make it visible to OpenAPI.
 */

const ContextSchema = z.object({
  projectId: z.string().uuid(),
  projectName: z.string(),
  teamId: z.string().uuid().nullable(),
  teamName: z.string().nullable(),
  timeZone: z.string(),
});

const TimeboxSchema = z.object({
  iterationId: z.string().uuid(),
  timeboxGroupId: z.string().uuid().nullable(),
  name: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  iterationCount: z.number().int(),
});

// ── Iteration Burndown ───────────────────────────────────────────────────────

const BurndownPointSchema = z.object({
  date: z.string(),
  // Null is a GAP, not zero: the day has no snapshot. A zero would read as "no work
  // remained", which is measured performance.
  remainingToDo: z.number().nullable(),
  acceptedPoints: z.number().nullable(),
  // Null when no Ideal baseline was captured: a zero line would be plotted and read as "the
  // plan was to do nothing".
  ideal: z.number().nullable(),
});

export const IterationBurndownResponseSchema = z.object({
  context: ContextSchema,
  timebox: TimeboxSchema,
  points: z.array(BurndownPointSchema),
  totalTaskEstimateAtStart: z.number().nullable(),
  // `no-baseline` is gone: the baseline governs the Ideal LINE (IB §3), and a missing one used
  // to discard measured bars. `totalTaskEstimateAtStart === null` is now how a client knows.
  historyState: z.enum(['complete', 'partial', 'missing', 'no-window']),
  status: z.enum(['on-track', 'behind-plan', 'unknown']),
  latestSnapshotDate: z.string().nullable(),
  hasScheduledWork: z.boolean(),
});
export class IterationBurndownResponseDto extends createZodDto(IterationBurndownResponseSchema) {}

// ── Velocity ─────────────────────────────────────────────────────────────────

const VelocityBarSchema = z.object({
  timeboxKey: z.string(),
  name: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  acceptedDuring: z.number(),
  acceptedAfter: z.number(),
  notAccepted: z.number(),
  // Points belonging to accepted items with no acceptedDate. In no segment and in no
  // average — surfaced so the gap is visible rather than absorbed.
  unclassified: z.number(),
  unclassifiedItems: z.number().int(),
  iterationCount: z.number().int(),
});

export const VelocityResponseSchema = z.object({
  context: ContextSchema,
  window: z.union([z.literal(5), z.literal(10)]),
  bars: z.array(VelocityBarSchema),
  averages: z.object({
    trend: z.number().nullable(),
    last3: z.number().nullable(),
    best3: z.number().nullable(),
    worst3: z.number().nullable(),
    sampleSize: z.number().int(),
  }),
  unclassifiedItems: z.number().int(),
});
export class VelocityResponseDto extends createZodDto(VelocityResponseSchema) {}

// ── Team Capacity ────────────────────────────────────────────────────────────

const HoursSchema = z.object({
  capacityHours: z.number(),
  estimateHours: z.number(),
  todoHours: z.number(),
  actualHours: z.number(),
});

export const TeamCapacityResponseSchema = z.object({
  context: ContextSchema,
  timebox: TimeboxSchema,
  totals: HoursSchema,
  teams: z.array(
    z.object({
      // Null for the synthetic `No Team` group — work whose Team cannot be resolved.
      id: z.string().uuid().nullable(),
      name: z.string(),
      totals: HoursSchema,
      members: z.array(
        z.object({
          // Null for the synthetic `Unassigned` group.
          id: z.string().uuid().nullable(),
          name: z.string(),
          hours: HoursSchema,
        }),
      ),
    }),
  ),
  hasCapacity: z.boolean(),
  hasTaskHours: z.boolean(),
});
export class TeamCapacityResponseDto extends createZodDto(TeamCapacityResponseSchema) {}

// ── Release Tracking ─────────────────────────────────────────────────────────

const StatusSchema = z.object({
  accepted: z.number(),
  total: z.number(),
  // Null when the denominator is zero, and always null on a Derived row (RT-BR-05).
  percent: z.number().nullable(),
});

const MismatchSchema = z.object({
  childId: z.string().uuid(),
  childKey: z.string(),
  childTitle: z.string(),
  childType: z.enum(['story', 'defect']),
  itemReleaseId: z.string().uuid(),
  itemReleaseName: z.string().nullable(),
});

const TrackingRowSchema = z.object({
  // Sequential within the active bucket (RT-AC-04), not the stored lexorank.
  rank: z.number().int(),
  id: z.string().uuid(),
  itemKey: z.string(),
  name: z.string(),
  teams: z.array(z.object({ id: z.string().uuid().nullable(), name: z.string() })),
  issueType: z.enum(['feature', 'story', 'defect']),
  state: z.string(),
  childCount: z.number().int(),
  status: StatusSchema,
  mismatches: z.array(MismatchSchema),
  fullMismatch: z.boolean(),
  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
  progress: z
    .object({ points: StatusSchema, stories: StatusSchema, defects: StatusSchema })
    .nullable(),
});

export const ReleaseTrackingResponseSchema = z.object({
  context: ContextSchema,
  release: z.object({
    id: z.string().uuid(),
    name: z.string(),
    startDate: z.string().nullable(),
    releaseDate: z.string().nullable(),
  }),
  unit: z.enum(['points', 'count']),
  bucket: z.enum(['direct', 'derived', 'unparented']),
  summary: z.object({
    direct: z.number().int(),
    derived: z.number().int(),
    unparented: z.number().int(),
  }),
  rows: z.array(TrackingRowSchema),
  totals: z.object({ planned: z.number(), accepted: z.number(), preliminary: z.number() }),
});
export class ReleaseTrackingResponseDto extends createZodDto(ReleaseTrackingResponseSchema) {}

export const ReleaseBurnupResponseSchema = z.object({
  unit: z.enum(['points', 'count']),
  points: z.array(
    z.object({
      date: z.string(),
      accepted: z.number().nullable(),
      planned: z.number().nullable(),
      preliminary: z.number().nullable(),
      // Null when no planning baseline is persisted — RT-BR-09 forbids reconstructing it
      // from today's Planned value.
      ideal: z.number().nullable(),
    }),
  ),
  historyState: z.enum(['complete', 'partial', 'missing', 'no-window']),
  /** Null when no Ideal target is stored — which is why every `ideal` above would be null. */
  idealTarget: z.number().nullable(),
  iterations: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
    }),
  ),
});
export class ReleaseBurnupResponseDto extends createZodDto(ReleaseBurnupResponseSchema) {}
