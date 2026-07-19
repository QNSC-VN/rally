import type { DefectRow, DefectMetrics, ListDefectsOptions } from '../quality.types';

export const QUALITY_REPOSITORY = Symbol('QUALITY_REPOSITORY');

export interface IQualityRepository {
  listDefects(
    workspaceId: string,
    projectId: string,
    opts: ListDefectsOptions,
  ): Promise<{ rows: DefectRow[] }>;

  computeMetrics(workspaceId: string, projectId: string): Promise<DefectMetrics>;
}
