import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const UserProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  locale: z.string(),
  timezone: z.string(),
});

const WorkspaceMembershipSchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  slug: z.string(),
  lastActiveAt: z.string().nullable(),
  /** User's primary role slug in this workspace, e.g. 'workspace_admin'. */
  roleSlug: z.string().nullable(),
  /** Human-readable role label, e.g. 'Workspace Admin'. */
  roleName: z.string().nullable(),
});

export const AuthTokenResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().describe('Seconds until access token expires'),
  user: UserProfileSchema,
  /** All active workspace memberships, most-recently-active first. Drives the workspace switcher. */
  memberships: z.array(WorkspaceMembershipSchema),
});

export class AuthTokenResponseDto extends createZodDto(AuthTokenResponseSchema) {}

export const UserProfileResponseSchema = UserProfileSchema.extend({
  role: z.string(),
  permissions: z.array(z.string()),
  emailVerified: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  /** All active workspace memberships, most-recently-active first. */
  memberships: z.array(WorkspaceMembershipSchema),
});

export class UserProfileResponseDto extends createZodDto(UserProfileResponseSchema) {}
