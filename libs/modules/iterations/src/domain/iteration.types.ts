import type { IterationState } from '../../../../../db/schema/enums';
export type { IterationState };

export interface Iteration {
  id: string;
  workspaceId: string;
  projectId: string;
  teamId: string | null;
  iterationKey: string | null;
  name: string;
  goal: string | null;
  theme: string | null;
  notes: string | null;
  state: IterationState;
  plannedVelocity: number | null;
  // Sum of child task estimate_hours (IT-001). Optional: only enriched on list.
  taskEstimate?: number;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateIterationInput {
  id: string;
  workspaceId: string;
  projectId: string;
  teamId?: string | null;
  iterationKey?: string | null;
  name: string;
  goal?: string;
  theme?: string;
  notes?: string;
  state?: IterationState;
  plannedVelocity?: number | null;
  startDate?: string;
  endDate?: string;
}

export interface UpdateIterationInput {
  name?: string;
  goal?: string | null;
  theme?: string | null;
  notes?: string | null;
  teamId?: string | null;
  state?: IterationState;
  plannedVelocity?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  completedAt?: Date | null;
}

/**
 * ELIGIBILITY: the iterations work may be assigned INTO — `planning | committed`.
 *
 * Consumers are the bulk-assign bar and the inline/sidebar assignment pickers. Deliberately NOT
 * the same projection as {@link IterationReference}: two questions are being asked, and a flag
 * that silently changes the population is the shape that produced the zero-point Velocity bars
 * (see CLAUDE.md, "Eligibility must be counted in the SAME scope as the measurement").
 */
export interface IterationOption {
  id: string;
  name: string;
  iterationKey: string | null;
  startDate: string | null;
  endDate: string | null;
  state: IterationState;
}

/**
 * REFERENCE: "what is this timebox called, and when was it?" — EVERY state, accepted included.
 *
 * Consumers are filters, id→name labels and the report scope pickers. It exists because
 * `GET /iterations` returns the timebox RECORD (`goal`, `theme`, `notes`, `plannedVelocity`),
 * which §3.2 hides from an Editor behind `timebox:view`, while the four surfaces §3.2 GRANTS an
 * Editor all need to name an iteration — including an accepted one, which the eligibility feed
 * above cannot offer.
 *
 * `teamId` is here and the record's narrative fields are not: the client half of
 * `teamOrSharedTimebox` (`iterationsInScope`) needs it to tell a team's own timebox from a shared
 * one. Declared as its own interface rather than a subset of {@link Iteration} so a field added to
 * the record cannot reach the feed a wider audience reads.
 */
export interface IterationReference {
  id: string;
  name: string;
  iterationKey: string | null;
  state: IterationState;
  startDate: string | null;
  endDate: string | null;
  teamId: string | null;
}

export interface IterationFilters {
  teamId?: string;
  state?: IterationState;
  /** Free-text search over name/theme. */
  q?: string;
}
