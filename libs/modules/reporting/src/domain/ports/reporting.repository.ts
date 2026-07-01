import type { SprintSnapshot, VelocityPoint } from '../reporting.types';

export const REPORTING_REPOSITORY = Symbol('REPORTING_REPOSITORY');

export interface IReportingRepository {
  getSprintSnapshots(tenantId: string, sprintId: string): Promise<SprintSnapshot[]>;
  getVelocity(tenantId: string, projectId: string, lastNSprints: number): Promise<VelocityPoint[]>;
  upsertSnapshot(snapshot: Omit<SprintSnapshot, 'id' | 'createdAt'>): Promise<void>;
}
