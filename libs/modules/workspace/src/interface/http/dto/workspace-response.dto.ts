import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const WorkspaceResponseSchema = z.object({
  id: z.string().uuid(),
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
  resendCount: z.number().int(),
  lastSentAt: z.string().datetime(),
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

/**
 * The ASSIGNEE / OWNER PICKER feed (`GET :id/member-options`).
 *
 * Four display fields and nothing else. It is NOT declared as a `.pick()` of the administrative
 * schema below on purpose: a shared base is how a field added for User Management ends up on the
 * feed every delivery participant reads, which is the defect (RBE-07) this split closes.
 */
export const MemberOptionResponseSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  status: z.string().describe('Workspace membership status: active | suspended | removed'),
});

export class MemberOptionResponseDto extends createZodDto(MemberOptionResponseSchema) {}

/**
 * The ADMINISTRATIVE roster (`GET :id/members-with-profile`), for User Management.
 *
 * `phone`, `lastLoginAt` and the four role fields are the reason this route is `workspace:view`
 * (Workspace Admin) gated while the picker feed above is not.
 */
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
  phone: z.string().nullable(),
  lastLoginAt: z.string().datetime().nullable(),
  roleAssignmentId: z.string().uuid().nullable(),
  roleId: z.string().uuid().nullable(),
  roleSlug: z.string().nullable(),
  roleName: z.string().nullable(),
  teams: z
    .array(z.object({ id: z.string().uuid(), key: z.string(), name: z.string() }))
    .default([]),
});

export class MemberWithProfileResponseDto extends createZodDto(MemberWithProfileResponseSchema) {}
