import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PROJECT_ACCESS_LEVEL } from '@shared-kernel';
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

/**
 * One project + level the invitation grants on acceptance (Settings §6.4, RBE-11).
 *
 * `PROJECT_ACCESS_LEVEL` from the catalogue, not a hand-written enum: this is the fourth place the
 * level set appears (CHECK constraint, `ACCESS_LEVEL_PERMISSIONS`, the SPA mirror), and the week a
 * third level existed and was removed again (migrations 0113, 0115) is what a literal here would
 * have got wrong.
 */
export const InvitationProjectAccessSchema = z.object({
  projectId: z.string().uuid(),
  accessLevel: z.enum(PROJECT_ACCESS_LEVEL),
});

export const InviteMemberSchema = z.object({
  email: z.string().email(),
  /**
   * NO `roleId`. An invitation cannot grant a workspace-wide role, and the field is absent rather
   * than validated so the contract does not advertise what the service would refuse — the same
   * reasoning `CreateTaskSchema` applies to a Task's derived iteration.
   *
   * Both possible values are forbidden, from opposite directions. `project_admin` / `project_member`
   * are refused at acceptance with `INVITED_ROLE_IS_PROJECT_TIER`, because a workspace-scoped grant of
   * a per-project role is the company-wide over-grant migration 0111 removed. And `workspace_admin` is
   * forbidden by the BA outright — `Phase 4/03_Settings_Audit/SRS.md:173`, "Invitation does not create
   * a Workspace Admin account". With those two excluded there is no third value left to accept, so a
   * field that took one could only ever mint an invitation nobody can redeem.
   *
   * That is not hypothetical: migration 0121 repointed pending invitations at `project_member` and
   * made them permanently unacceptable, which migration 0125 repairs. Keeping the field would leave
   * the API able to recreate exactly that state.
   *
   * `workspace_invitations.role_id` stays in the schema — accepted rows are history — but nothing
   * writes it now. Access comes from `projectAccess` below (§6.4) and from a per-project grant made
   * after the member joins.
   */
  /**
   * Optional, and an empty list is legal — that is the pre-§6.4 behaviour: the invitee lands with
   * no project access and stays No Access until someone grants a level. Making it required would
   * break every existing caller and force a choice on an inviter who has not made one.
   *
   * Deliberately a plain object schema with NO `superRefine`. The duplicate-project rule lives in
   * `WorkspaceService.assertInvitationProjectAccess` instead: wrapping this schema in a refinement
   * makes it a `ZodEffects`, and the committed API client is generated from the OpenAPI document
   * these DTOs produce (`pnpm --filter rally-web codegen`, diffed by the `OpenAPI contract` job) —
   * so a shape change here is a client change, for a rule the service enforces anyway.
   */
  projectAccess: z.array(InvitationProjectAccessSchema).optional(),
});

/**
 * `.strict()`, so a `roleId` is a 400 rather than a silent strip.
 *
 * Zod drops unknown keys by default, which for a removed field is the wrong failure: a caller still
 * sending `roleId` would be told the invitation succeeded while the value was discarded, and would
 * reasonably believe it had granted a role. That is the class of quiet mismatch this repo already
 * refuses elsewhere — `TASK_ITERATION_DERIVED` exists because discarding a derived field silently was
 * judged worse than refusing it.
 *
 * `InviteMemberSchema` itself stays non-strict so the shape stays a plain object: wrapping it in a
 * refinement would make it a `ZodEffects` and change the generated client, which is the reasoning the
 * `projectAccess` docblock above already records.
 */
export const InviteMemberStrictSchema = InviteMemberSchema.strict();

export class InviteMemberDto extends createZodDto(InviteMemberStrictSchema) {}

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
