import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Every report query carries `projectId` and an OPTIONAL `teamId`, and nothing else about
 * scope: the SRS is explicit that "Project and Team come from the global workspace context.
 * A report must not create a second Project or Team filter."
 *
 * `projectId` is also what `@RequirePermission('report:view', { from: 'query', field:
 * 'projectId' })` resolves the project-tier check against, so it is required on every route
 * even where a release or iteration id would imply it.
 *
 * An absent `teamId` means All Teams — never "unfiltered". `.nullable()` because the SPA
 * serialises "no team selected" as an omitted parameter, and an empty string arrives from a
 * hand-built URL.
 */
const scope = {
  projectId: z.string().uuid(),
  teamId: z.string().uuid().optional().nullable(),
};

// ── GET /reports/iteration-burndown ──────────────────────────────────────────

export const IterationBurndownQuerySchema = z.object({
  ...scope,
  // The iteration the picker selected. For All Teams the server resolves its timebox group
  // and fuses every participating Team's iteration; the client never has to know the group.
  iterationId: z.string().uuid(),
});
export class IterationBurndownQueryDto extends createZodDto(IterationBurndownQuerySchema) {}

// ── GET /reports/velocity ────────────────────────────────────────────────────

export const VelocityQuerySchema = z.object({
  ...scope,
  // `Last 5 sprints` / `Last 10 sprints`, defaulting to 5 (§6). A closed enum rather than a
  // clamped number: the report offers exactly two windows, and the averages' sample-size
  // reporting is only meaningful against one of them.
  window: z.coerce
    .number()
    .int()
    .pipe(z.union([z.literal(5), z.literal(10)]))
    .optional(),
});
export class VelocityQueryDto extends createZodDto(VelocityQuerySchema) {}

// ── GET /reports/team-capacity ───────────────────────────────────────────────

export const TeamCapacityQuerySchema = z.object({
  ...scope,
  iterationId: z.string().uuid(),
});
export class TeamCapacityQueryDto extends createZodDto(TeamCapacityQuerySchema) {}

// ── GET /reports/release-tracking (+ /burnup) ────────────────────────────────

export const CHART_UNITS = ['points', 'count'] as const;
export const RELEASE_BUCKETS = ['direct', 'derived', 'unparented'] as const;

export const ReleaseTrackingQuerySchema = z.object({
  ...scope,
  releaseId: z.string().uuid(),
  // One unit selector drives both the grid's Status column and the chart (RT-BR-05).
  unit: z.enum(CHART_UNITS).optional(),
  // "The list filter displays one bucket at a time" (§5) — the rows returned are the active
  // bucket's, while all three summary totals come back regardless.
  bucket: z.enum(RELEASE_BUCKETS).optional(),
});
export class ReleaseTrackingQueryDto extends createZodDto(ReleaseTrackingQuerySchema) {}

export const ReleaseBurnupQuerySchema = z.object({
  ...scope,
  releaseId: z.string().uuid(),
  unit: z.enum(CHART_UNITS).optional(),
});
export class ReleaseBurnupQueryDto extends createZodDto(ReleaseBurnupQuerySchema) {}
