import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';
import { projectStatusEnum, projectMemberStatusEnum } from '../../../../../../../db/schema/enums';

// ── Create Project ───────────────────────────────────────────────────────────

export const CreateProjectSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Za-z][A-Za-z0-9]*$/, 'Key must start with a letter and be alphanumeric'),
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(2000).trim().optional(),
  leadId: z.string().uuid().optional(),
  workspaceId: z.string().uuid(),
});

export class CreateProjectDto extends createZodDto(CreateProjectSchema) {}

// ── Update Project ───────────────────────────────────────────────────────────

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  description: z.string().max(2000).trim().optional().nullable(),
  leadId: z.string().uuid().optional().nullable(),
  status: z.enum(projectStatusEnum.enumValues).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export class UpdateProjectDto extends createZodDto(UpdateProjectSchema) {}

// ── Pagination query ─────────────────────────────────────────────────────────

export const ProjectQuerySchema = PageQuerySchema.extend({
  workspaceId: z.string().uuid(),
});

export class ProjectQueryDto extends createZodDto(ProjectQuerySchema) {}

// ── Labels ───────────────────────────────────────────────────────────────────

export const CreateLabelSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex code like #3b82f6')
    .optional(),
});

export class CreateLabelDto extends createZodDto(CreateLabelSchema) {}

export const UpdateLabelSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex code like #3b82f6')
    .optional(),
});

export class UpdateLabelDto extends createZodDto(UpdateLabelSchema) {}

// ── Update Project Member ─────────────────────────────────────────────────────

export const UpdateProjectMemberSchema = z.object({
  roleId: z.string().uuid().optional(),
  status: z.enum(projectMemberStatusEnum.enumValues).optional(),
});

export class UpdateProjectMemberDto extends createZodDto(UpdateProjectMemberSchema) {}
