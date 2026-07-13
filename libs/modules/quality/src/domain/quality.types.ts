/**
 * Quality domain types — defect metrics and filtered list.
 */
import type { DefectSeverity, DefectEnvironment, DefectRootCause, DefectResolution, WorkItemScheduleState } from '../../../../../db/schema/enums';

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