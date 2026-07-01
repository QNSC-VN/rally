import type { SprintStatus } from '../../../../../db/schema/enums';
export type { SprintStatus };

export interface Sprint {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  goal: string | null;
  status: SprintStatus;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSprintInput {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
}

export interface UpdateSprintInput {
  name?: string;
  goal?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: SprintStatus;
  completedAt?: Date | null;
}
