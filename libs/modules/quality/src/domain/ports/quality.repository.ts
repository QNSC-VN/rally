import type { DefectRow, DefectMetrics, ListDefectsOptions } from '../quality.types';
import type { TeamReadScope } from '../team-read-scope';

export const QUALITY_REPOSITORY = Symbol('QUALITY_REPOSITORY');

/**
 * `scope` is REQUIRED on both methods, not optional with an "unrestricted" default.
 *
 * `computeMetrics` deliberately ignores the caller's FILTERS — the KPI strip counts the whole project's
 * defects, not the page — which makes it the one query where a missing team predicate is invisible:
 * the grid would narrow correctly while the six cards above it still counted every team's defects.
 * A required parameter turns forgetting it into a compile error. (CLAUDE.md: "Eligibility must be
 * counted in the SAME scope as the measurement".)
 */
export interface IQualityRepository {
  listDefects(
    workspaceId: string,
    projectId: string,
    opts: ListDefectsOptions,
    scope: TeamReadScope,
  ): Promise<{ rows: DefectRow[]; total: number }>;

  computeMetrics(
    workspaceId: string,
    projectId: string,
    scope: TeamReadScope,
  ): Promise<DefectMetrics>;
}
