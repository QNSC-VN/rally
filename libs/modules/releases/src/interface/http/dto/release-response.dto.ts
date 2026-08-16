import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const RELEASE_STATES = ['planning', 'active', 'accepted'] as const;

/**
 * The right panel's roll-up: Task Roll-up hours plus the accepted work total.
 *
 * KEPT ON PURPOSE, AGAINST THE SRS, BECAUSE REAL RALLY HAS IT. Rally's own Release field reference
 * documents exactly these as rolled-up totals — "**Plan Estimate, Task Estimate, Accepted, and To
 * Do**" are "totals rolled up from the estimates given for the associated scheduled items", and
 * `Accepted` "calculates and displays the total of scheduled item estimates whose state has been set
 * to accepted"
 * (`techdocs.broadcom.com/.../working-with-releases/release-fields.html`). This product is a Rally
 * clone, so where the two disagree the product wins and the BA is asked to amend the SRS.
 *
 * These fields were briefly DELETED on the SRS's word (`P3-REL-FR-023`, `FR-024`, `FR-018`, `DC-009`,
 * AC-10 and `TS-016` all describe a metadata-only panel) and restored once the Rally reference was
 * read. Recorded so the next reader does not re-delete them: the SRS statements are not wrong about
 * what the BA wants, they are wrong about Rally, and that is a BA question, not a code one.
 *
 * WHAT RALLY REALLY DOES NOT HAVE, and what therefore stays deleted: a Release **percent-done** field,
 * a progress **bar**, and a Release **burndown**. Rally's Release carries no completion metric at all,
 * and its release chart is a burn**up** living under Reports — so the old progress panel and
 * `GET /releases/:id/burndown` were inventions, and `FR-037`'s "progress belongs to
 * `Portfolio > Release Tracking`" agrees with Rally on that half. Hours and an accepted COUNT are
 * totals, not progress.
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
