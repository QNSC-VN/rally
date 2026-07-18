/**
 * Quality domain types — defect metrics and filtered list.
 */
import type {
  DefectSeverity,
  DefectEnvironment,
  DefectRootCause,
  DefectResolution,
  WorkItemScheduleState,
} from '../../../../../db/schema/enums';

export interface DefectMetrics {
  openDefects: number;
  critical: number;
  inProgress: number;
  verifiedAccepted: number;
  reopened: number;
  blockers: number;
}

export interface DefectRow {
  id: string;
  itemKey: string;
  title: string;
  type: string;
  priority: string;
  severity: DefectSeverity | null;
  foundInEnvironment: DefectEnvironment | null;
  rootCause: DefectRootCause | null;
  resolution: DefectResolution | null;
  foundInReleaseId: string | null;
  foundInReleaseName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  scheduleState: WorkItemScheduleState;
  iterationId: string | null;
  iterationName: string | null;
  releaseId: string | null;
  releaseName: string | null;
  parentId: string | null;
  parentKey: string | null;
  parentTitle: string | null;
  isBlocked: boolean;
  rank: string;
  defectState: string | null;
  fixedInBuild: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DefectListResult {
  metrics: DefectMetrics;
  data: DefectRow[];
}

/**
 * Sortable defect columns. Drives the `sort` query param → server-side ORDER BY,
 * mirroring the backlog {@link WorkItemSortBy} pattern so the grids stay
 * consistent. Enum columns (`severity`, `priority`, `state`, `scheduleState`)
 * sort by their semantic Postgres enum declaration order.
 */
export type QualitySortBy =
  | 'id'
  | 'name'
  | 'userStory'
  | 'severity'
  | 'priority'
  | 'state'
  | 'scheduleState'
  | 'fixedInBuild'
  | 'iteration'
  | 'submittedBy'
  | 'owner';

/** Whitelist of defect sort fields accepted from the `sort` query param. */
export const DEFECT_SORT_FIELDS = [
  'id',
  'name',
  'userStory',
  'severity',
  'priority',
  'state',
  'scheduleState',
  'fixedInBuild',
  'iteration',
  'submittedBy',
  'owner',
] as const satisfies readonly QualitySortBy[];

/**
 * Options for {@link IQualityRepository.listDefects} — the single source of
 * truth for the defect list query shape (filters + sort + window), shared by
 * the controller, service and repository so they can never drift.
 */
export interface ListDefectsOptions {
  search?: string;
  severity?: string;
  environment?: string;
  priority?: string;
  scheduleState?: string;
  assigneeId?: string;
  releaseId?: string;
  rootCause?: string;
  resolution?: string;
  defectState?: string;
  sortBy?: QualitySortBy;
  sortDirection?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
