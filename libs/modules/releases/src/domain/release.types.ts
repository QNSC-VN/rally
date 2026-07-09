import type { ReleaseStatus } from '../../../../../db/schema/enums';
export type { ReleaseStatus };

export interface Release {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  description: string | null;
  theme: string | null;
  notes: string | null;
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

export interface CreateReleaseInput {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  description?: string;
  theme?: string;
  startDate?: string;
  releaseDate?: string;
  status?: ReleaseStatus;
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
}