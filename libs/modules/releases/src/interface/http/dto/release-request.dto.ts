import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ISO_DATE, PageQuerySchema } from '@platform';

export const ReleaseQuerySchema = PageQuerySchema.extend({
  projectId: z.string().uuid(),
});
export class ReleaseQueryDto extends createZodDto(ReleaseQuerySchema) {}

/**
 * Query for `GET /releases/:id/artifacts`.
 *
 * Its own schema because the release is already named by the path — and because reusing
 * {@link ReleaseQuerySchema} here made `projectId` REQUIRED on a route that has no reason to take
 * one. The ValidationPipe runs before the guard and before the handler, so every request the SPA
 * ever sent (`?limit=…&q=…`) was rejected as a 400 and the Artifacts tab rendered its empty state —
 * exactly the "Release Artifacts query/display" defect in the register.
 *
 * `q` matches item key or title (P3-REL-FR-033: the same core dashboard behaviour as Backlog,
 * starting with search). It was being sent and silently dropped.
 */
export const ReleaseArtifactQuerySchema = PageQuerySchema.extend({
  q: z.string().trim().max(255).optional(),
});
export class ReleaseArtifactQueryDto extends createZodDto(ReleaseArtifactQuerySchema) {}

const RELEASE_STATES = ['planning', 'active', 'accepted'] as const;

export const CreateReleaseSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(5000).optional(),
  theme: z.string().max(5000).optional(),
  startDate: ISO_DATE.optional(),
  releaseDate: ISO_DATE.optional(),
  state: z.enum(RELEASE_STATES).optional().default('planning'),
  releaseNotes: z.string().max(50000).nullable().optional(),
});
export class CreateReleaseDto extends createZodDto(CreateReleaseSchema) {}

export const UpdateReleaseSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  description: z.string().max(5000).nullable().optional(),
  theme: z.string().max(5000).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  startDate: ISO_DATE.nullable().optional(),
  releaseDate: ISO_DATE.nullable().optional(),
  plannedVelocity: z.number().int().min(0).nullable().optional(),
  planEstimate: z.number().min(0).nullable().optional(),
  version: z.string().max(100).nullable().optional(),
  state: z.enum(RELEASE_STATES).optional(),
  releaseNotes: z.string().max(50000).nullable().optional(),
});
export class UpdateReleaseDto extends createZodDto(UpdateReleaseSchema) {}
