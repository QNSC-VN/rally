import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const RELEASE_STATES = ['planning', 'active', 'accepted'] as const;

/**
 * The right panel's roll-up (P3-REL-FR-018): Task Roll-up hours (FR-023) plus the accepted
 * work total (FR-024). No percentage and no point totals — FR-037 forbids a Release Progress
 * widget on the Phase 3 list/detail and §7.5 defers progress to `Portfolio > Release Tracking`.
 */
const TaskRollupSchema = z.object({
  estimateHours: z.number(),
  toDoHours: z.number(),
  actualHours: z.number(),
  acceptedItems: z.number(),
});

const ReleaseListItemSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  releaseKey: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  theme: z.string().nullable(),
  status: z.enum(RELEASE_STATES),
  startDate: z.string().nullable().describe('YYYY-MM-DD'),
  releaseDate: z.string().nullable().describe('YYYY-MM-DD'),
  plannedVelocity: z.number().nullable(),
  planEstimate: z.number().nullable(),
  taskEstimate: z.number().describe('Roll-up: summed estimate hours of assigned work items'),
  projectName: z.string().optional(),
});

export const ReleaseResponseSchema = ReleaseListItemSchema.extend({
  notes: z.string().nullable(),
  releaseNotes: z.string().nullable(),
  version: z.string().nullable(),
  releasedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  taskRollup: TaskRollupSchema.optional(),
});

export class ReleaseResponseDto extends createZodDto(ReleaseResponseSchema) {}

export class ReleaseListItemDto extends createZodDto(ReleaseListItemSchema) {}

/**
 * One row of the Release Artifacts dashboard (P3-REL-FR-032: assigned Story/Defect work items "using
 * the Backlog dashboard presentation").
 *
 * The route used to declare `ApiPagedResponse(ReleaseResponseDto)` — a RELEASE — for a page of work
 * items, so the generated client typed the response as something it never returns and the SPA hook
 * had to cast the whole client through `as unknown as` to call it at all. Kept field-for-field
 * identical to `MilestoneArtifactDto`, because one shared table renders both.
 */
export const ReleaseArtifactSchema = z.object({
  id: z.string().uuid(),
  itemKey: z.string(),
  type: z.string(),
  title: z.string(),
  scheduleState: z.string(),
  priority: z.string(),
  assigneeId: z.string().uuid().nullable(),
  assigneeName: z.string().nullable(),
  iterationId: z.string().uuid().nullable(),
  releaseId: z.string().uuid().nullable(),
  storyPoints: z.number().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class ReleaseArtifactDto extends createZodDto(ReleaseArtifactSchema) {}
