import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { milestoneStatusEnum } from '../../../../../../../db/schema/enums';

const MilestoneProgressSchema = z.object({
  totalItems: z.number(),
  completedItems: z.number(),
  totalPoints: z.number(),
  completedPoints: z.number(),
  /** Null when not computable — nothing estimated and not everything finished. */
  progressPercent: z.number().nullable(),
});

export const MilestoneResponseSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  milestoneKey: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(milestoneStatusEnum.enumValues),
  ownerId: z.string().uuid().nullable(),
  targetStartDate: z
    .string()
    .nullable()
    .describe('YYYY-MM-DD, manually set or derived from linked releases'),
  targetEndDate: z
    .string()
    .nullable()
    .describe('YYYY-MM-DD, manually set or derived from linked releases'),
  releaseIds: z.array(z.string().uuid()),
  projectIds: z.array(z.string().uuid()).optional(),
  teamIds: z.array(z.string().uuid()).optional(),
  progress: MilestoneProgressSchema.optional().describe(
    'Work-item completion across linked releases',
  ),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class MilestoneResponseDto extends createZodDto(MilestoneResponseSchema) {}

export const MilestoneListItemSchema = MilestoneResponseSchema;
export class MilestoneListItemDto extends createZodDto(MilestoneListItemSchema) {}

/**
 * One row of the Milestone Artifacts dashboard (P3-MS-FR-019/020: "the same presentation pattern as
 * Backlog", with search and pagination).
 *
 * `GET :id/artifacts` answers with the LINK ids — what the replace-set write in §5.2 takes back — so
 * the dashboard reads `:id/artifacts/items` instead. The two are deliberately separate resources
 * rather than one route with two shapes; that is what the SPA was already assuming, and getting the
 * ids where it expected rows is why the tab rendered its empty state for every milestone.
 */
export const MilestoneArtifactSchema = z.object({
  id: z.string().uuid(),
  itemKey: z.string(),
  type: z.string(),
  title: z.string(),
  scheduleState: z.string(),
  priority: z.string(),
  assigneeId: z.string().uuid().nullable(),
  assigneeName: z.string().nullable(),
  storyPoints: z.number().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class MilestoneArtifactDto extends createZodDto(MilestoneArtifactSchema) {}
