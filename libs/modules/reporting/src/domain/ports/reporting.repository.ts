import type { SprintSnapshot, VelocityPoint } from '../reporting.types';

export const REPORTING_REPOSITORY = Symbol('REPORTING_REPOSITORY');

export interface IReportingRepository {
  /** The project a sprint belongs to (for permission scoping), or null if absent. */
  getSprintSnapshots(workspaceId: string, sprintId: string): Promise<SprintSnapshot[]>;
  getVelocity(workspaceId: string, projectId: string, lastNSprints: number): Promise<VelocityPoint[]>;
  upsertSnapshot(snapshot: Omit<SprintSnapshot, 'id' | 'createdAt'>): Promise<void>;
}
