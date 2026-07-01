import type { ReleaseStatus } from '../../../../../db/schema/enums';
export type { ReleaseStatus };

export interface Release {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  description: string | null;
  status: ReleaseStatus;
  targetDate: string | null; // YYYY-MM-DD
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
  targetDate?: string;
}

export interface UpdateReleaseInput {
  name?: string;
  description?: string | null;
  targetDate?: string | null;
  status?: ReleaseStatus;
  releasedAt?: Date | null;
}
