import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  projectStatusEnum,
  workflowStatusCategoryEnum,
} from '../../../../../../../db/schema/enums';

export const ProjectResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  key: z.string().max(10).describe('Unique short project key e.g. PROJ'),
  name: z.string(),
  description: z.string().nullable(),
  leadId: z.string().uuid().nullable(),
  leadName: z.string().nullable(),
  status: z.enum(projectStatusEnum.enumValues).describe('Project status: active | archived'),
  memberCount: z.number().int().min(0),
  teamCount: z.number().int().min(0),
  settings: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class ProjectResponseDto extends createZodDto(ProjectResponseSchema) {}

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
