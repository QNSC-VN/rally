import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const TenantResponseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.string().describe('Tenant status: active | suspended | deleted'),
  plan: z.string(),
  settings: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class TenantResponseDto extends createZodDto(TenantResponseSchema) {}

export const WorkspaceResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  settings: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class WorkspaceResponseDto extends createZodDto(WorkspaceResponseSchema) {}

export const MemberResponseSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  roleId: z.string().uuid().nullable(),
  status: z.string(),
  joinedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export class MemberResponseDto extends createZodDto(MemberResponseSchema) {}

export const InvitationResponseSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  email: z.string().email(),
  roleId: z.string().uuid().nullable(),
  status: z.string().describe('Invitation status: pending | accepted | cancelled | expired'),
  invitedBy: z.string().uuid(),
  expiresAt: z.string().datetime(),
  acceptedBy: z.string().uuid().nullable(),
  acceptedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export class InvitationResponseDto extends createZodDto(InvitationResponseSchema) {}

export const WorkspaceSettingsResponseSchema = z.object({
  workspaceId: z.string().uuid(),
  timezone: z.string().nullable(),
  defaultLocale: z.string().nullable(),
  dateFormat: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export class WorkspaceSettingsResponseDto extends createZodDto(WorkspaceSettingsResponseSchema) {}

export const MemberWithProfileResponseSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  status: z.string(),
  joinedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  displayName: z.string(),
  email: z.string().email(),
  avatarUrl: z.string().nullable(),
  roleAssignmentId: z.string().uuid().nullable(),
  roleId: z.string().uuid().nullable(),
  roleSlug: z.string().nullable(),
  roleName: z.string().nullable(),
});

export class MemberWithProfileResponseDto extends createZodDto(MemberWithProfileResponseSchema) {}
