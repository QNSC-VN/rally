import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const WorkItemResponseSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  itemKey: z.string().describe('Sequential key e.g. PROJ-42'),
  type: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  statusId: z.string().uuid(),
  scheduleState: z.string(),
  flowState: z.string(),
  priority: z.string(),
  assigneeId: z.string().uuid().nullable(),
  assigneeName: z
    .string()
    .nullable()
    .describe(
      'Owner display name, joined server-side on the grid reads. A picker feed cannot name a ' +
        'Workspace Admin (no project_members row, §2.1), so the row carries its own name.',
    ),
  devOwnerName: z.string().nullable(),
  reporterId: z.string().uuid().nullable(),
  parentId: z.string().uuid().nullable(),
  teamId: z.string().uuid().nullable(),
  iterationId: z.string().uuid().nullable(),
  releaseId: z.string().uuid().nullable(),
  featureId: z
    .string()
    .uuid()
    .nullable()
    .describe('The Feature this item rolls up to. Always null for a task.'),
  storyPoints: z.number().nullable(),
  estimateHours: z.number().nullable(),
  todoHours: z.number().nullable(),
  actualHours: z.number().nullable(),
  acceptanceCriteria: z.string().nullable(),
  notes: z.string().nullable(),
  releaseNotes: z.string().nullable(),
  isBlocked: z.boolean(),
  blockedReason: z.string().nullable(),
  rank: z.string(),
  customFields: z.record(z.string(), z.unknown()),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // P3.4 — Defect-specific fields
  severity: z.string().nullable(),
  foundInEnvironment: z.string().nullable(),
  foundInReleaseId: z.string().uuid().nullable(),
  rootCause: z.string().nullable(),
  resolution: z.string().nullable(),
  devOwnerId: z.string().uuid().nullable(),
  defectState: z.string().nullable(),
  fixedInBuild: z.string().nullable(),
});

export class WorkItemResponseDto extends createZodDto(WorkItemResponseSchema) {}

export type WorkItemResponseDtoShape = z.infer<typeof WorkItemResponseSchema>;

// ── Task totals (Tasks-tab totals row) ──────────────────────────────────────

export const TaskTotalsResponseSchema = z.object({
  taskCount: z.number().int(),
  estimateHours: z.number(),
  todoHours: z.number(),
  actualHours: z.number(),
});

export class TaskTotalsResponseDto extends createZodDto(TaskTotalsResponseSchema) {}

// ── Home dashboard aggregates ────────────────────────────────────────────────

export const MyWorkItemResponseSchema = z.object({
  id: z.string().uuid(),
  itemKey: z.string(),
  type: z.string(),
  title: z.string(),
  scheduleState: z.string(),
  priority: z.string(),
  projectId: z.string().uuid(),
  projectKey: z.string(),
  projectName: z.string(),
});

export class MyWorkItemResponseDto extends createZodDto(MyWorkItemResponseSchema) {}

export const WorkspaceSummaryResponseSchema = z.object({
  activeProjects: z.number().int().min(0),
  openWorkItems: z.number().int().min(0),
  activeSprints: z.number().int().min(0),
  blockedItems: z.number().int().min(0),
  openDefects: z.number().int().min(0),
  assignedToMe: z.number().int().min(0),
});

export class WorkspaceSummaryResponseDto extends createZodDto(WorkspaceSummaryResponseSchema) {}

// ── Activity (Revision History) ─────────────────────────────────────────────

export const ActivityResponseSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  actorId: z.string().uuid().nullable(),
  /** Display name of the actor, resolved server-side. */
  actorName: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  changes: z.object({ field: z.string(), old: z.unknown(), new: z.unknown() }).nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export class ActivityResponseDto extends createZodDto(ActivityResponseSchema) {}

export type ActivityResponseDtoShape = z.infer<typeof ActivityResponseSchema>;

// ── Time log ──────────────────────────────────────────────────────────────────

export const TimeLogResponseSchema = z.object({
  id: z.string().uuid(),
  workItemId: z.string().uuid(),
  userId: z.string().uuid(),
  loggedDate: z.string().describe('ISO date YYYY-MM-DD'),
  hours: z.number().describe('Hours logged (positive, max 24)'),
  description: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class TimeLogResponseDto extends createZodDto(TimeLogResponseSchema) {}

export type TimeLogResponseDtoShape = z.infer<typeof TimeLogResponseSchema>;

// ── Watcher ───────────────────────────────────────────────────────────────────

export const WatcherResponseSchema = z.object({
  userId: z.string().uuid(),
  watchedAt: z.string().datetime(),
});

export class WatcherResponseDto extends createZodDto(WatcherResponseSchema) {}

// ── Parent Story reference feed ───────────────────────────────────────────────

/**
 * The Story REFERENCE feed's row — the picker behind a Defect's `Parent Story` field.
 *
 * A separate schema, not a `.pick()` of {@link WorkItemResponseSchema}, for the same reason
 * `PortfolioFeatureOptionSchema` is: a field added to the record shape must not silently join a
 * feed that a wider audience reads.
 */
export const StoryOptionSchema = z.object({
  id: z.string().uuid(),
  itemKey: z.string().describe('US-<n>, unique across the workspace'),
  title: z.string(),
  projectId: z.string().uuid().describe('Always the requested project; echoed for binding'),
});

export class StoryOptionResponseDto extends createZodDto(StoryOptionSchema) {}

export type StoryOptionResponseDtoShape = z.infer<typeof StoryOptionSchema>;
