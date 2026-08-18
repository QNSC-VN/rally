import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const RELEASE_STATES = ['planning', 'active', 'accepted'] as const;

/**
 * Task Roll-up hours plus the accepted work total — the BA's own §7.4 Release Detail DTO
 * (`taskRollup` + `accepted`), which is why the contract still carries it.
 *
 * **No Phase 3 surface may RENDER any of it.** FR-023 forbids a Task Roll-up, Burndown or other
 * release progress widget on Release Detail, FR-024 puts accepted/progress totals in
 * `Portfolio > Release Tracking` alone, FR-037 keeps a progress column/widget off the Phase 3
 * list, and AC #10 makes the right panel metadata only — re-confirmed by the BA's 2026-08-17
 * retest (`GAP-P3-REL-001`). The SPA's `Release` mirror deliberately does not declare this field.
 * No percentage and no point totals here either: §7.5 defers progress out of Phase 3.2.
 */
const TaskRollupSchema = z.object({
  estimateHours: z.number(),
  toDoHours: z.number(),
  actualHours: z.number(),
  acceptedItems: z.number(),
});

const ReleaseListItemSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  releaseKey: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  theme: z.string().nullable(),
  status: z.enum(RELEASE_STATES),
  startDate: z.string().nullable().describe('YYYY-MM-DD'),
  releaseDate: z.string().nullable().describe('YYYY-MM-DD'),
  plannedVelocity: z.number().nullable(),
  planEstimate: z.number().nullable(),
  taskEstimate: z.number().describe('Roll-up: summed estimate hours of assigned work items'),
  projectName: z.string().optional(),
});

export const ReleaseResponseSchema = ReleaseListItemSchema.extend({
  notes: z.string().nullable(),
  releaseNotes: z.string().nullable(),
  version: z.string().nullable(),
  releasedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  taskRollup: TaskRollupSchema.optional(),
});

export class ReleaseResponseDto extends createZodDto(ReleaseResponseSchema) {}

export class ReleaseListItemDto extends createZodDto(ReleaseListItemSchema) {}

/**
 * The RELEASE REFERENCE feed (`GET /releases/options`) — enough to label, order and choose a
 * release, and nothing else.
 *
 * WHY IT EXISTS
 * `GET /releases` is the `Plan > Releases` administration grid's feed and carries the release
 * RECORD: `theme`, `notes`, `releaseNotes`, `plannedVelocity`, `planEstimate`, `taskEstimate`,
 * `version`, `releasedAt` and the task roll-up. §3.2 marks the `Timeboxes` surface (Iterations,
 * Releases and Milestones alike) Hidden for an Editor, which is why it takes `release:view` — a code
 * `PROJECT_MEMBER` deliberately does not hold. It was ALSO the only feed for the Release picker and
 * the Release *name* on Backlog, the Work Item detail sidebar, the Backlog summary panel and
 * Quality's release filter, all of which §3.2 grants an Editor. A 403 there defaults to `[]`, and the
 * name is resolved by looking the item's `releaseId` up in that array — so a row assigned to a real
 * release rendered as unscheduled (`EMPTY_VALUE`) for every Editor, and no release could be chosen.
 *
 * Same defect, same split and same reasoning as `GET /projects/:id/member-options` and
 * `GET /workspaces/:id/member-options`: the gate was right and the FEED was the defect.
 *
 * A SEPARATE SCHEMA, not a `.pick()` of {@link ReleaseResponseSchema} or a second extension of
 * `ReleaseListItemSchema`. A shared base is exactly how a field added for the administration grid
 * later joins the feed every participant reads — which is the whole point of the split.
 *
 * The window (`startDate` / `releaseDate`) is here because a picker LABELS and ORDERS by it (the
 * capacity-plan range pickers sort oldest-first by start date; Release Tracking's selector shows the
 * window). A release's dates are not administration data — the theme, notes, velocity and estimates
 * are, and none of them is here.
 */
export const ReleaseOptionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  releaseKey: z.string().nullable(),
  name: z.string(),
  status: z.enum(RELEASE_STATES),
  startDate: z.string().nullable().describe('YYYY-MM-DD'),
  releaseDate: z.string().nullable().describe('YYYY-MM-DD'),
});

export class ReleaseOptionDto extends createZodDto(ReleaseOptionSchema) {}

/**
 * One row of the Release Artifacts dashboard (P3-REL-FR-032: assigned Story/Defect work items "using
 * the Backlog dashboard presentation").
 *
 * The route used to declare `ApiPagedResponse(ReleaseResponseDto)` — a RELEASE — for a page of work
 * items, so the generated client typed the response as something it never returns and the SPA hook
 * had to cast the whole client through `as unknown as` to call it at all. Kept field-for-field
 * identical to `MilestoneArtifactDto`, because one shared table renders both.
 */
export const ReleaseArtifactSchema = z.object({
  id: z.string().uuid(),
  itemKey: z.string(),
  type: z.string(),
  title: z.string(),
  scheduleState: z.string(),
  priority: z.string(),
  assigneeId: z.string().uuid().nullable(),
  assigneeName: z.string().nullable(),
  iterationId: z.string().uuid().nullable(),
  releaseId: z.string().uuid().nullable(),
  storyPoints: z.number().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class ReleaseArtifactDto extends createZodDto(ReleaseArtifactSchema) {}
