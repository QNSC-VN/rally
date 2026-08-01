import { z } from 'zod';
import { preliminaryEstimateSizeEnum } from '../../../../../../../db/schema/enums';

const SETTINGS_SIZES = preliminaryEstimateSizeEnum.enumValues;
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
  // When supplied, replaces the user's full set of team memberships (SRS §6.3 / USER-FR-008).
  teamIds: z.array(z.string().uuid()).optional(),
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
  /**
   * T-shirt size → points/count. PARTIAL: send only the sizes being changed, and the server
   * merges them over what is stored.
   *
   * Whole numbers only, matching Rally ("Values must be whole numbers"), and non-negative
   * because these are denominators. The size KEYS are fixed by the `preliminary_estimate_size`
   * enum — Rally lets an admin add and delete sizes too, which our column cannot express, so
   * that part is deliberately out of scope rather than half-built.
   */
  // `partialRecord`, NOT `record`: with an enum key zod 4's `record` is EXHAUSTIVE and would
  // demand all six sizes on every request, which defeats the point of a partial patch.
  preliminaryEstimateMap: z
    .partialRecord(
      z.enum(SETTINGS_SIZES),
      z.object({ points: z.number().int().min(0), count: z.number().int().min(0) }),
    )
    .optional(),
});

export class UpdateWorkspaceSettingsDto extends createZodDto(UpdateWorkspaceSettingsSchema) {}
