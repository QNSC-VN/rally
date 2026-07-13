import type { DefectRow, DefectMetrics } from '../quality.types';

export const QUALITY_REPOSITORY = Symbol('QUALITY_REPOSITORY');

export interface IQualityRepository {
  listDefects(
    workspaceId: string,
    projectId: string,
    opts: {
      search?: string;
      severity?: string;
      environment?: string;
      priority?: string;
      scheduleState?: string;
      assigneeId?: string;
      releaseId?: string;
      rootCause?: string;
      resolution?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ rows: DefectRow[] }>;

  computeMetrics(workspaceId: string, projectId: string): Promise<DefectMetrics>;
}
