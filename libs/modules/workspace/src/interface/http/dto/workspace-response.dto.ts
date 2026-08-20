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

/**
 * The response of `POST :id/invitations/:invitationId/link` — a freshly rotated
 * accept URL the inviter can hand over by any channel (chat, in person), for the
 * members email cannot reach: an internal colleague behind a mail filter that
 * quarantines transactional senders, or anyone whose invite keeps landing in junk.
 * Rotating means the URL in this response is the ONLY live one — a previously
 * emailed link dies the moment this is issued.
 */
export const InvitationLinkResponseSchema = z.object({
  invitationId: z.string().uuid(),
  email: z.string().email(),
  inviteUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});

export class InvitationLinkResponseDto extends createZodDto(InvitationLinkResponseSchema) {}

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
 * Four display fields plus one DECISION, and nothing else. It is NOT declared as a `.pick()` of the
 * administrative schema below on purpose: a shared base is how a field added for User Management ends
 * up on the feed every delivery participant reads, which is the defect (RBE-07) this split closes.
 *
 * That is not hypothetical here — it happened on this very schema. The fifth field shipped as
 * `status: 'active' | 'suspended' | 'removed'`, taken straight off `workspace_members`, while this
 * docblock still said "four display fields and nothing else": a person's account state, on the one
 * feed in the product with no permission code, read by every participant, and consumed by no client at
 * all. `assignable` keeps the behaviour the field was added for (a picker must not OFFER an inactive
 * member, but their name must still resolve for an item they already own) and drops the disclosure.
 * The project-level twin, `ProjectMemberOptionResponseSchema`, carries no status field either.
 */
export const MemberOptionResponseSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  assignable: z
    .boolean()
    .describe(
      'Whether a picker may offer this person as a new owner (derived, not the raw status)',
    ),
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
