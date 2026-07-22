import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  projectStatusEnum,
  workflowStatusCategoryEnum,
} from '../../../../../../../db/schema/enums';

export const ProjectResponseSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  key: z.string().max(10).describe('Unique short project key e.g. PROJ'),
  name: z.string(),
  description: z.string().nullable(),
  leadId: z.string().uuid().nullable(),
  leadName: z.string().nullable(),
  startDate: z.string().nullable().describe('YYYY-MM-DD'),
  status: z.enum(projectStatusEnum.enumValues).describe('Project status: active | archived'),
  memberCount: z.number().int().min(0),
  teamCount: z.number().int().min(0),
  settings: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class ProjectResponseDto extends createZodDto(ProjectResponseSchema) {}

/** Home "Project Health" widget row — bounded, attention-sorted rollup. */
export const ProjectHealthResponseSchema = z.object({
  id: z.string().uuid(),
  key: z.string().max(10),
  name: z.string(),
  leadId: z.string().uuid().nullable(),
  leadName: z.string().nullable(),
  activeSprintName: z.string().nullable(),
  progressPercent: z.number().int().min(0).max(100),
  openDefects: z.number().int().min(0),
  blockedCount: z.number().int().min(0),
});

export class ProjectHealthResponseDto extends createZodDto(ProjectHealthResponseSchema) {}

export const WorkflowStatusResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  category: z.enum(workflowStatusCategoryEnum.enumValues),
  color: z.string().nullable(),
  position: z.number().int(),
  isDefault: z.boolean(),
});

export class WorkflowStatusResponseDto extends createZodDto(WorkflowStatusResponseSchema) {}

export const WorkflowTransitionResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  fromStatusId: z.string().uuid().nullable(),
  toStatusId: z.string().uuid(),
  name: z.string().nullable(),
  requiredRole: z.string().nullable(),
});

export class WorkflowTransitionResponseDto extends createZodDto(WorkflowTransitionResponseSchema) {}

export const LabelResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  color: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class LabelResponseDto extends createZodDto(LabelResponseSchema) {}
