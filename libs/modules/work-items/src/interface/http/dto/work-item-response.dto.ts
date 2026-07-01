import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const WorkItemResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  itemKey: z.string().describe('Sequential key e.g. PROJ-42'),
  type: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  statusId: z.string().uuid(),
  scheduleState: z.string(),
  priority: z.string(),
  assigneeId: z.string().uuid().nullable(),
  reporterId: z.string().uuid().nullable(),
  parentId: z.string().uuid().nullable(),
  teamId: z.string().uuid().nullable(),
  iterationId: z.string().uuid().nullable(),
  releaseId: z.string().uuid().nullable(),
  storyPoints: z.number().int().nullable(),
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

// ── Attachment ────────────────────────────────────────────────────────────────

export const PresignAttachmentResponseSchema = z.object({
  attachmentId: z.string().uuid(),
  uploadUrl: z.string().url().describe('Presigned S3 PUT URL — expires in 5 minutes'),
});

export class PresignAttachmentResponseDto extends createZodDto(PresignAttachmentResponseSchema) {}

export const AttachmentResponseSchema = z.object({
  id: z.string().uuid(),
  workItemId: z.string().uuid(),
  uploadedBy: z.string().uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(['pending', 'completed']),
  createdAt: z.string().datetime(),
});

export class AttachmentResponseDto extends createZodDto(AttachmentResponseSchema) {}

export const DownloadUrlResponseSchema = z.object({
  downloadUrl: z.string().url().describe('Presigned S3 GET URL — expires in 15 minutes'),
});

export class DownloadUrlResponseDto extends createZodDto(DownloadUrlResponseSchema) {}
