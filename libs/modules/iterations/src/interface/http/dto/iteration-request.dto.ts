import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';
import { iterationStateEnum } from '../../../../../../../db/schema/enums';

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format');

// ── List query ────────────────────────────────────────────────────────────────

export const IterationQuerySchema = PageQuerySchema.extend({
  projectId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  state: z.enum(iterationStateEnum.enumValues).optional(),
  q: z.string().max(255).optional(),
});

export class IterationQueryDto extends createZodDto(IterationQuerySchema) {}

// ── Activity (Revision History) pagination ──────────────────────────────────

export const IterationActivityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export class IterationActivityQueryDto extends createZodDto(IterationActivityQuerySchema) {}

// ── Create ────────────────────────────────────────────────────────────────────

export const CreateIterationSchema = z.object({
  projectId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  name: z.string().min(1).max(255).trim(),
  goal: z.string().max(2000).optional(),
  theme: z.string().max(20000).optional(),
  notes: z.string().max(20000).optional(),
  /**
   * Defaults to `planning` when omitted (P2-IT-FR-023). `committed` is legal at birth — committing
   * early is — but `accepted` is REFUSED by `IterationsService.createIteration`
   * (`ITERATION_EMPTY`): acceptance is a condition over membership and a new iteration has none.
   * The enum stays whole here because it is the shared `iterations.state` enum and the refusal
   * carries the reason in its message; see `domain/iteration-state.ts`.
   */
  state: z.enum(iterationStateEnum.enumValues).optional(),
  startDate: ISO_DATE.optional(),
  endDate: ISO_DATE.optional(),
  plannedVelocity: z.number().int().min(0).optional(),
});

export class CreateIterationDto extends createZodDto(CreateIterationSchema) {}

// ── Update ────────────────────────────────────────────────────────────────────

export const UpdateIterationSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  goal: z.string().max(2000).nullable().optional(),
  theme: z.string().max(20000).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  state: z.enum(iterationStateEnum.enumValues).optional(),
  startDate: ISO_DATE.nullable().optional(),
  endDate: ISO_DATE.nullable().optional(),
  plannedVelocity: z.number().int().min(0).nullable().optional(),
});

export class UpdateIterationDto extends createZodDto(UpdateIterationSchema) {}

// ── Accept iteration (carry-over target for unfinished items) ────────────────────

export const RolloverIterationSchema = z.object({
  /**
   * Optional target iteration for the unfinished items.
   * If omitted, unfinished items are moved back to the backlog (iterationId = null).
   */
  moveToIterationId: z.string().uuid().optional(),
});

export class RolloverIterationDto extends createZodDto(RolloverIterationSchema) {}

// ── Compact-feed query (P2-IT-10) ────────────────────────────────────────
//
// Shared by BOTH compact feeds — `GET /iterations/options` (reference) and
// `GET /iterations/assignable` (eligibility). The two differ in POPULATION, not in what the caller
// asks for, so one query shape is honest here; what must never be shared is the RESPONSE
// projection, and it is not (see IterationReferenceSchema).
//
// `teamId` means "the team's own timeboxes PLUS the project's shared ones" on both, never a strict
// `team_id = ?`: most iterations name no team, and SQL equality never matches NULL.

export const IterationAssignmentOptionsQuerySchema = z.object({
  projectId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
});

export class IterationAssignmentOptionsQueryDto extends createZodDto(
  IterationAssignmentOptionsQuerySchema,
) {}
