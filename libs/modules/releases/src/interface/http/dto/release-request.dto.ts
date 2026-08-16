import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ISO_DATE, PageQuerySchema } from '@platform';

export const ReleaseQuerySchema = PageQuerySchema.extend({
  projectId: z.string().uuid(),
});
export class ReleaseQueryDto extends createZodDto(ReleaseQuerySchema) {}

/**
 * Query for `GET /releases/options` — the reference feed.
 *
 * Its own schema rather than {@link ReleaseQuerySchema}, because a picker takes the whole set: there
 * is no cursor to carry and no page size to choose, and inheriting `PageQuerySchema` would let a
 * caller silently truncate the option list to a page (the shape that made a real release read as
 * unscheduled in the first place). Deliberately NOT reused from the artifacts query either — the
 * `ValidationPipe` runs before the guard, so a field this route has no reason to require would be a
 * 400 the picker could never diagnose.
 */
export const ReleaseOptionsQuerySchema = z.object({
  projectId: z.string().uuid(),
});
export class ReleaseOptionsQueryDto extends createZodDto(ReleaseOptionsQuerySchema) {}

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
  /**
   * REQUIRED, both of them — `P3-REL-FR-021` ("Release detail Start Date and Release Date are
   * required") and §6.1 `:144`/`:145`, which mark each `Required` and add "must be >= Start Date".
   *
   * They were `.optional()`, so the rule lived only in the create modal's own validation and a release
   * with no window was one API call away. 66 of 91 rows on the development database have one or both
   * missing, which is what that permits. A release with no window is not cosmetic either: Phase 6
   * reports it as `historyState: 'no-window'` and the snapshot job writes nothing for it, so the
   * burnup is permanently empty for a release nobody can tell is misconfigured.
   *
   * The UPDATE schema keeps them `.optional()` — a PATCH need not mention a field — but drops
   * `.nullable()`, so an existing row cannot be CLEARED back to the state this rule forbids. Rows that
   * already have NULLs stay fully editable, including to set the dates for the first time.
   */
  startDate: ISO_DATE,
  releaseDate: ISO_DATE,
  state: z.enum(RELEASE_STATES).optional().default('planning'),
  releaseNotes: z.string().max(50000).nullable().optional(),
});
export class CreateReleaseDto extends createZodDto(CreateReleaseSchema) {}

export const UpdateReleaseSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  description: z.string().max(5000).nullable().optional(),
  theme: z.string().max(5000).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  // Not `.nullable()`: see the create schema above. A PATCH may omit either date, but it may not
  // clear one, because `P3-REL-FR-021` makes both required for the release to be valid at all.
  startDate: ISO_DATE.optional(),
  releaseDate: ISO_DATE.optional(),
  plannedVelocity: z.number().int().min(0).nullable().optional(),
  planEstimate: z.number().min(0).nullable().optional(),
  version: z.string().max(100).nullable().optional(),
  state: z.enum(RELEASE_STATES).optional(),
  releaseNotes: z.string().max(50000).nullable().optional(),
});
export class UpdateReleaseDto extends createZodDto(UpdateReleaseSchema) {}
