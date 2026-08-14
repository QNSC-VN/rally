import type { ReleaseStatus } from '../../../../../db/schema/enums';
export type { ReleaseStatus };

export interface Release {
  id: string;
  workspaceId: string;
  projectId: string;
  releaseKey: string | null;
  name: string;
  description: string | null;
  theme: string | null;
  notes: string | null;
  releaseNotes: string | null;
  status: ReleaseStatus;
  startDate: string | null; // YYYY-MM-DD
  releaseDate: string | null; // YYYY-MM-DD
  targetDate: string | null; // YYYY-MM-DD (legacy)
  plannedVelocity: number | null;
  planEstimate: number | null;
  version: string | null;
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The reference projection of a release: what a picker needs to label, order and choose one.
 *
 * A type of its own rather than `Pick<Release, …>`, for the same reason
 * `ReleaseOptionSchema` is not a `.pick()` of the response schema — a field added to the record must
 * not be able to reach the feed every delivery participant reads. See that schema's docblock.
 */
export interface ReleaseOption {
  id: string;
  projectId: string;
  releaseKey: string | null;
  name: string;
  status: ReleaseStatus;
  startDate: string | null; // YYYY-MM-DD
  releaseDate: string | null; // YYYY-MM-DD
}

export interface CreateReleaseInput {
  id: string;
  workspaceId: string;
  projectId: string;
  releaseKey?: string | null;
  name: string;
  description?: string;
  theme?: string;
  startDate?: string;
  releaseDate?: string;
  status?: ReleaseStatus;
  releaseNotes?: string;
}

export interface UpdateReleaseInput {
  name?: string;
  description?: string | null;
  theme?: string | null;
  notes?: string | null;
  startDate?: string | null;
  releaseDate?: string | null;
  plannedVelocity?: number | null;
  planEstimate?: number | null;
  version?: string | null;
  status?: ReleaseStatus;
  releasedAt?: Date | null;
  releaseNotes?: string | null;
}
