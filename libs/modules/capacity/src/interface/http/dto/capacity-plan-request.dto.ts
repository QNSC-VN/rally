import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ISO_DATE } from '@platform';
import { capacityPlanUnitEnum } from '../../../../../../../db/schema/enums';

// Derived from the DB enum rather than re-listed, so the API cannot accept a unit the
// column rejects.
const UNITS = capacityPlanUnitEnum.enumValues;

/**
 * Advisory load ceiling. Range matches `ck_capacity_target_load_range` exactly (1–100).
 *
 * 100 is permitted and means "reserve no headroom" — warn only once a team is genuinely
 * over capacity. That is a coherent choice, so the API does not forbid it; Rally's own
 * guidance of roughly 80% is expressed as the column DEFAULT instead. Keeping the bound
 * identical to the CHECK matters: a stricter DTO would make a value the schema accepts
 * unreachable through the API, with nothing explaining why.
 */
const TARGET_LOAD = z.number().int().min(1).max(100);

/**
 * Capacity in the plan's unit. Non-negative per `ck_capacity_non_negative`.
 *
 * Accepted as a NUMBER on the wire and stored as a numeric string — the same boundary
 * conversion the portfolio DTOs do for `refinedEstimate`.
 */
const CAPACITY = z.number().nonnegative();

export const CapacityPlanListQuerySchema = z.object({
  /** REQUIRED: a plan belongs to one project, and the route gate scopes on it. */
  projectId: z.string().uuid(),
});
export class CapacityPlanListQueryDto extends createZodDto(CapacityPlanListQuerySchema) {}

export const CreateCapacityPlanSchema = z.object({
  projectId: z.string().uuid(),
  releaseId: z.string().uuid(),
  name: z.string().min(1).max(255).trim(),
  /**
   * REQUIRED and immutable afterwards. Every number on the plan — including each
   * allocation value — is expressed in it, so there is no safe default and no safe change.
   */
  unit: z.enum(UNITS),
  plannedStartDate: ISO_DATE.nullable().optional(),
  plannedEndDate: ISO_DATE.nullable().optional(),
  targetLoadPct: TARGET_LOAD.optional(),
});
export class CreateCapacityPlanDto extends createZodDto(CreateCapacityPlanSchema) {}

/**
 * `unit`, `projectId` and `releaseId` are absent deliberately: the unit reinterprets every
 * stored allocation, and (project, release) is the plan's identity under
 * `uq_capacity_plan_project_release`.
 */
export const UpdateCapacityPlanSchema = z
  .object({
    name: z.string().min(1).max(255).trim().optional(),
    plannedStartDate: ISO_DATE.nullable().optional(),
    plannedEndDate: ISO_DATE.nullable().optional(),
    targetLoadPct: TARGET_LOAD.optional(),
  })
  // An empty body would bump `updated_at` and return 200 having changed nothing, which
  // reads as a successful save.
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export class UpdateCapacityPlanDto extends createZodDto(UpdateCapacityPlanSchema) {}

export const AddCapacityTeamSchema = z.object({
  teamId: z.string().uuid(),
});
export class AddCapacityTeamDto extends createZodDto(AddCapacityTeamSchema) {}

export const SetCapacitySchema = z.object({
  /**
   * `null` CLEARS the capacity back to "not entered", which is not the same as `0`.
   * Explicitly nullable rather than optional so clearing is an intentional act — an
   * omitted field would be indistinguishable from a no-op.
   */
  capacity: CAPACITY.nullable(),
});
export class SetCapacityDto extends createZodDto(SetCapacitySchema) {}

/**
 * Commit demand for a Feature.
 *
 * `teamId` null (or omitted) parks it in the Unallocated bucket. `value` omitted accepts the
 * server default, which is Refined → Preliminary and deliberately SKIPS the allocated tier
 * so a blank field cannot commit the sum of the allocations it is creating.
 */
export const AllocateSchema = z.object({
  portfolioItemId: z.string().uuid(),
  teamId: z.string().uuid().nullable().optional(),
  value: CAPACITY.optional(),
});
export class AllocateDto extends createZodDto(AllocateSchema) {}

export const UpdateAllocationSchema = z
  .object({
    value: CAPACITY.optional(),
    /** Explicit null moves the row into the Unallocated bucket. */
    teamId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export class UpdateAllocationDto extends createZodDto(UpdateAllocationSchema) {}
