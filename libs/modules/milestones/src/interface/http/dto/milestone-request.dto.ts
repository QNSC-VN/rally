import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';

export const MilestoneQuerySchema = PageQuerySchema.extend({
  projectId: z.string().uuid(),
});
export class MilestoneQueryDto extends createZodDto(MilestoneQuerySchema) {}

export const CreateMilestoneSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(5000).optional(),
  notes: z.string().max(10000).optional(),
  status: z.enum(['planned', 'at_risk', 'met', 'missed', 'cancelled', 'completed']).optional(),
  ownerId: z.string().uuid().optional(),
  targetStartDate: z.string().date().optional(),
  targetEndDate: z.string().date().optional(),
  releaseIds: z.array(z.string().uuid()),
  projectIds: z.array(z.string().uuid()).optional(),
  teamIds: z.array(z.string().uuid()).optional(),
});
export class CreateMilestoneDto extends createZodDto(CreateMilestoneSchema) {}

export const UpdateMilestoneSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  description: z.string().max(5000).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  status: z.enum(['planned', 'at_risk', 'met', 'missed', 'cancelled', 'completed']).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  targetStartDate: z.string().date().nullable().optional(),
  targetEndDate: z.string().date().nullable().optional(),
  releaseIds: z.array(z.string().uuid()).optional(),
  projectIds: z.array(z.string().uuid()).optional(),
  teamIds: z.array(z.string().uuid()).optional(),
});
export class UpdateMilestoneDto extends createZodDto(UpdateMilestoneSchema) {}

// ── Set-links (replace-all) request bodies ──────────────────────────────────
// Field names intentionally mirror the client payload (projectIds / teamIds /
// workItemIds) so the contract is self-documenting; validation turns a
// malformed body into a 400 instead of an unhandled 500.
export const SetMilestoneProjectsSchema = z.object({
  projectIds: z.array(z.string().uuid()),
});
export class SetMilestoneProjectsDto extends createZodDto(SetMilestoneProjectsSchema) {}

export const SetMilestoneTeamsSchema = z.object({
  teamIds: z.array(z.string().uuid()),
});
export class SetMilestoneTeamsDto extends createZodDto(SetMilestoneTeamsSchema) {}

export const SetMilestoneArtifactsSchema = z.object({
  workItemIds: z.array(z.string().uuid()),
});
export class SetMilestoneArtifactsDto extends createZodDto(SetMilestoneArtifactsSchema) {}

export const SetMilestoneReleasesSchema = z.object({
  releaseIds: z.array(z.string().uuid()),
});
export class SetMilestoneReleasesDto extends createZodDto(SetMilestoneReleasesSchema) {}