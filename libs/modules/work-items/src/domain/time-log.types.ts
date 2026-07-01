export interface TimeLog {
  id: string;
  tenantId: string;
  workItemId: string;
  userId: string;
  /** ISO date string, e.g. "2026-06-25" */
  loggedDate: string;
  /** Stored as Drizzle numeric → string to preserve precision. */
  hours: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateTimeLogInput {
  id: string;
  tenantId: string;
  workItemId: string;
  userId: string;
  loggedDate: string;
  hours: string;
  description?: string;
}

export interface UpdateTimeLogInput {
  hours?: string;
  description?: string | null;
  loggedDate?: string;
}
