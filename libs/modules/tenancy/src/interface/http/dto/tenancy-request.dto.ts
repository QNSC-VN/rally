import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { workspaceMemberStatusEnum } from '../../../../../../../db/schema/enums';

// ── Create Workspace ─────────────────────────────────────────────────────────

export const CreateWorkspaceSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(1000).trim().optional(),
  avatarUrl: z.url().optional(),
});

export class CreateWorkspaceDto extends createZodDto(CreateWorkspaceSchema) {}

// ── Update Workspace ─────────────────────────────────────────────────────────

export const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  description: z.string().max(1000).trim().optional(),
  avatarUrl: z.url().optional().nullable(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export class UpdateWorkspaceDto extends createZodDto(UpdateWorkspaceSchema) {}

// ── Add Member ───────────────────────────────────────────────────────────────

export const AddMemberSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().min(1).max(100).optional(),
});

export class AddMemberDto extends createZodDto(AddMemberSchema) {}

// ── Update Member ─────────────────────────────────────────────────────────────

export const UpdateMemberSchema = z.object({
  roleId: z.string().min(1).max(100).optional(),
  status: z.enum(workspaceMemberStatusEnum.enumValues).optional(),
});

export class UpdateMemberDto extends createZodDto(UpdateMemberSchema) {}

// ── Invite Member ─────────────────────────────────────────────────────────────

export const InviteMemberSchema = z.object({
  email: z.string().email(),
  roleId: z.string().min(1).max(100).optional(),
});

export class InviteMemberDto extends createZodDto(InviteMemberSchema) {}

// ── Accept Invitation ─────────────────────────────────────────────────────────

export const AcceptInvitationSchema = z.object({
  token: z.string().min(1),
});

export class AcceptInvitationDto extends createZodDto(AcceptInvitationSchema) {}

// ── Workspace Settings ────────────────────────────────────────────────────────

export const UpdateWorkspaceSettingsSchema = z.object({
  timezone: z.string().min(1).max(100).optional(),
  defaultLocale: z.string().min(2).max(10).optional(),
  dateFormat: z.string().min(1).max(50).optional(),
});

export class UpdateWorkspaceSettingsDto extends createZodDto(UpdateWorkspaceSettingsSchema) {}
