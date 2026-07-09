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

/** Compact projection used by the assignment-options picker endpoint. */
export interface IterationOption {
  id: string;
  name: string;
  iterationKey: string | null;
  startDate: string | null;
  endDate: string | null;
  state: IterationState;
}

/** Sort keys supported by the iteration list endpoint. */
export type IterationSortBy =
  | 'name'
  | 'theme'
  | 'startDate'
  | 'endDate'
  | 'state'
  | 'plannedVelocity';

export interface IterationFilters {
  teamId?: string;
  state?: IterationState;
  /** Free-text search over name/theme. */
  q?: string;
  sortBy?: IterationSortBy;
  sortDirection?: 'asc' | 'desc';
}
