import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { capacityPlanStatusEnum, capacityPlanUnitEnum } from '../../../../../../../db/schema/enums';

const STATUSES = capacityPlanStatusEnum.enumValues;
const UNITS = capacityPlanUnitEnum.enumValues;

const CapacityPlanTeamSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  teamName: z.string().nullable(),
  /**
   * `null` means the planner has not entered a capacity yet — NOT zero capacity. The grid
   * renders blank, and no warning rule may treat it as a real ceiling.
   */
  capacity: z.number().nullable(),
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
});
export class CapacityPlanResponseDto extends createZodDto(CapacityPlanSchema) {}
