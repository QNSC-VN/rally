import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';
import {
  workItemTypeEnum,
  workItemPriorityEnum,
  workItemScheduleStateEnum,
} from '../../../../../../../db/schema/enums';

const WORK_ITEM_TYPES = workItemTypeEnum.enumValues;
const WORK_ITEM_PRIORITIES = workItemPriorityEnum.enumValues;
const SCHEDULE_STATES = workItemScheduleStateEnum.enumValues;

// Hours: accept a non-negative number, persist as fixed(2) string (Drizzle numeric).
const hoursOptional = z.coerce
  .number()
  .min(0)
  .max(999999.99)
  .optional()
  .transform((v) => (v === undefined ? undefined : v.toFixed(2)));

const hoursNullable = z.coerce
  .number()
  .min(0)
  .max(999999.99)
  .nullable()
  .optional()
  .transform((v) => (v === undefined || v === null ? v : v.toFixed(2)));

// ── List query ────────────────────────────────────────────────────────────────

export const WorkItemQuerySchema = PageQuerySchema.extend({
  projectId: z.string().uuid(),
  type: z.enum(WORK_ITEM_TYPES).optional(),
  statusId: z.string().uuid().optional(),
  scheduleState: z.enum(SCHEDULE_STATES).optional(),
  priority: z.enum(WORK_ITEM_PRIORITIES).optional(),
  assigneeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  iterationId: z.string().uuid().optional(),
  releaseId: z.string().uuid().optional(),
  q: z.string().trim().max(255).optional(),
});

export class WorkItemQueryDto extends createZodDto(WorkItemQuerySchema) {}

// ── Create ────────────────────────────────────────────────────────────────────

export const CreateWorkItemSchema = z.object({
  projectId: z.string().uuid(),
  type: z.enum(WORK_ITEM_TYPES),
  title: z.string().min(1).max(500).trim(),
  description: z.string().max(50000).optional(),
  statusId: z.string().uuid().optional(),
  scheduleState: z.enum(SCHEDULE_STATES).optional(),
  priority: z.enum(WORK_ITEM_PRIORITIES).default('none'),
  assigneeId: z.string().uuid().optional(),
  reporterId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  storyPoints: z.coerce.number().int().min(0).max(999).optional(),
  estimateHours: hoursOptional,
  todoHours: hoursOptional,
  actualHours: hoursOptional,
  acceptanceCriteria: z.string().max(50000).optional(),
  notes: z.string().max(50000).optional(),
  releaseNotes: z.string().max(50000).optional(),
});

export class CreateWorkItemDto extends createZodDto(CreateWorkItemSchema) {}

// ── Update ────────────────────────────────────────────────────────────────────

export const UpdateWorkItemSchema = z.object({
  title: z.string().min(1).max(500).trim().optional(),
  description: z.string().max(50000).nullable().optional(),
  statusId: z.string().uuid().optional(),
  scheduleState: z.enum(SCHEDULE_STATES).optional(),
  priority: z.enum(WORK_ITEM_PRIORITIES).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  reporterId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  iterationId: z.string().uuid().nullable().optional(),
  releaseId: z.string().uuid().nullable().optional(),
  storyPoints: z.coerce.number().int().min(0).max(999).nullable().optional(),
  estimateHours: hoursNullable,
  todoHours: hoursNullable,
  actualHours: hoursNullable,
  acceptanceCriteria: z.string().max(50000).nullable().optional(),
  notes: z.string().max(50000).nullable().optional(),
  releaseNotes: z.string().max(50000).nullable().optional(),
  isBlocked: z.boolean().optional(),
  blockedReason: z.string().max(1000).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export class UpdateWorkItemDto extends createZodDto(UpdateWorkItemSchema) {}

// ── Create task (Tasks tab) ─────────────────────────────────────────────────

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500).trim(),
  description: z.string().max(50000).optional(),
  statusId: z.string().uuid().optional(),
  scheduleState: z.enum(SCHEDULE_STATES).optional(),
  assigneeId: z.string().uuid().optional(),
  estimateHours: hoursOptional,
  todoHours: hoursOptional,
  actualHours: hoursOptional,
});

export class CreateTaskDto extends createZodDto(CreateTaskSchema) {}

// ── Activity query ──────────────────────────────────────────────────────────

export const ActivityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export class ActivityQueryDto extends createZodDto(ActivityQuerySchema) {}

// ── Move (status transition) ──────────────────────────────────────────────────

export const MoveWorkItemSchema = z.object({
  toStatusId: z.string().uuid(),
});

export class MoveWorkItemDto extends createZodDto(MoveWorkItemSchema) {}

// ── Reorder (backlog rank) ────────────────────────────────────────────────────

export const ReorderWorkItemsSchema = z.object({
  items: z
    .array(z.object({ id: z.string().uuid(), rank: z.string().min(1).max(255) }))
    .min(1)
    .max(500),
});

export class ReorderWorkItemsDto extends createZodDto(ReorderWorkItemsSchema) {}

// ── Add label ─────────────────────────────────────────────────────────────────

export const AddLabelSchema = z.object({
  labelId: z.string().uuid(),
});

export class AddLabelDto extends createZodDto(AddLabelSchema) {}

// ── Time log ──────────────────────────────────────────────────────────────────

export const CreateTimeLogSchema = z.object({
  loggedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  hours: z.coerce.number().positive().max(24).transform((v) => v.toFixed(2)),
  description: z.string().max(2000).optional(),
});

export class CreateTimeLogDto extends createZodDto(CreateTimeLogSchema) {}

export const UpdateTimeLogSchema = z.object({
  loggedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .optional(),
  hours: z.coerce
    .number()
    .positive()
    .max(24)
    .optional()
    .transform((v) => (v === undefined ? undefined : v.toFixed(2))),
  description: z.string().max(2000).nullable().optional(),
});

export class UpdateTimeLogDto extends createZodDto(UpdateTimeLogSchema) {}

export const TimeLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export class TimeLogQueryDto extends createZodDto(TimeLogQuerySchema) {}

// ── Attachment ────────────────────────────────────────────────────────────────

export const PresignAttachmentSchema = z.object({
  filename: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
});

export class PresignAttachmentDto extends createZodDto(PresignAttachmentSchema) {}

