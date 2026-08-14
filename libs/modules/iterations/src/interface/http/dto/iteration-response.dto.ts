import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { iterationStateEnum } from '../../../../../../../db/schema/enums';

export const IterationResponseSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  teamId: z.string().uuid().nullable(),
  iterationKey: z.string().nullable(),
  name: z.string(),
  goal: z.string().nullable(),
  theme: z.string().nullable(),
  notes: z.string().nullable(),
  state: z.enum(iterationStateEnum.enumValues),
  plannedVelocity: z.number().int().nullable(),
  // Sum of child task estimate_hours for the iteration (IT-001). Optional: only
  // the list endpoint enriches it, so other iteration responses may omit it.
  taskEstimate: z.number().optional(),
  startDate: z.string().nullable().describe('YYYY-MM-DD'),
  endDate: z.string().nullable().describe('YYYY-MM-DD'),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class IterationResponseDto extends createZodDto(IterationResponseSchema) {}

// ── The two compact feeds (P2-IT-10) ─────────────────────────────────────────

/**
 * ELIGIBILITY — `GET /iterations/assignable`. The iterations work may be assigned INTO
 * (`planning | committed`).
 */
export const IterationOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  iterationKey: z.string().nullable(),
  startDate: z.string().nullable().describe('YYYY-MM-DD'),
  endDate: z.string().nullable().describe('YYYY-MM-DD'),
  state: z.enum(iterationStateEnum.enumValues),
});

export class IterationOptionDto extends createZodDto(IterationOptionSchema) {}

/**
 * REFERENCE — `GET /iterations/options`. Every state, so an accepted timebox still resolves to a
 * name.
 *
 * DECLARED IN FULL, NOT AS `IterationResponseSchema.pick(...)`, and that is load-bearing: a shared
 * base is how the next field added for the `Plan > Timeboxes` grid joins the feed every Editor
 * surface reads. `goal`, `theme`, `notes` and `plannedVelocity` are the timebox RECORD — §3.2 hides
 * that surface from an Editor and `timebox:view` exists to enforce it — so they must be
 * *unreachable* from here, not merely omitted today.
 *
 * `iterationKey` is present because it is display IDENTITY: every one of these surfaces labels an
 * iteration `"{KEY}: {name}"`, the same form `ReleaseOptionDto.releaseKey` and
 * `MilestoneOptionDto.milestoneKey` carry. `teamId` is present because `iterationsInScope` — the
 * client half of `teamOrSharedTimebox` — needs to tell a team's own timebox from a shared one.
 */
export const IterationReferenceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  iterationKey: z.string().nullable(),
  state: z.enum(iterationStateEnum.enumValues),
  startDate: z.string().nullable().describe('YYYY-MM-DD'),
  endDate: z.string().nullable().describe('YYYY-MM-DD'),
  teamId: z.string().uuid().nullable(),
});

export class IterationReferenceDto extends createZodDto(IterationReferenceSchema) {}

// ── Activity (Revision History) ─────────────────────────────────────────────

export const IterationActivityResponseSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  actorId: z.string().uuid().nullable(),
  /** Display name of the actor, resolved server-side. */
  actorName: z.string().nullable(),
  action: z.string(),
  changes: z.object({ field: z.string(), old: z.unknown(), new: z.unknown() }).nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export class IterationActivityResponseDto extends createZodDto(IterationActivityResponseSchema) {}
