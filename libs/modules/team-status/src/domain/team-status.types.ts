/**
 * Team Status domain types — P3.1
 *
 * Dense grouped table of task-level rows per iteration, grouped by
 * owner/member. Sourced from Mini_Rally_pj Phase 3 SRS §8.2.
 */

/** Normalized task-state values used in Team Status UI. */
export type TeamTaskState = 'Defined' | 'In-Progress' | 'Completed';

/** Work product parent type. */
export type WorkProductType = 'Story' | 'Defect' | 'Feature';

/** Owner info embedded in response. */
export interface TeamStatusOwner {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Work product (parent work item) reference. */
export interface TeamStatusWorkProduct {
  id: string;
  key: string;
  type: WorkProductType;
  title: string;
  status: string;
}

/** Release reference. */
export interface TeamStatusRelease {
  id: string;
  name: string;
}

/** One task row inside a member group. */
export interface TeamStatusTaskRow {
  id: string;
  taskKey: string;
  title: string;
  displayName: string;
  workProduct: TeamStatusWorkProduct;
  release: TeamStatusRelease | null;
  state: TeamTaskState;
  estimateHours: number;
  todoHours: number;
  actualHours: number;
  owner: TeamStatusOwner;
  rank: string | null;
}

/** One member group (aggregated over that member's tasks). */
export interface TeamStatusMemberGroup {
  owner: TeamStatusOwner;
  capacityHours: number;
  taskCount: number;
  estimateHours: number;
  todoHours: number;
  actualHours: number;
  progressPercent: number;
  tasks: TeamStatusTaskRow[];
}

/** Totals row for the table. */
export interface TeamStatusTotals {
  capacityHours: number;
  estimateHours: number;
  todoHours: number;
  actualHours: number;
}

/** Top-level response DTO shape. */
export interface TeamStatusResponse {
  projectId: string;
  teamId: string;
  iteration: {
    id: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
  };
  totals: TeamStatusTotals;
  groups: TeamStatusMemberGroup[];
}

/** Input for updating member capacity. */
export interface UpdateCapacityInput {
  projectId: string;
  teamId: string;
  iterationId: string;
  userId: string;
  capacityHours: number;
}

/** Input for updating a task from Team Status. */
export interface UpdateTaskFromTeamStatusInput {
  title?: string;
  state?: TeamTaskState;
}

/** Raw DB row shape for task-level query (internal). */
export interface RawTeamStatusTaskRow {
  id: string;
  itemKey: string;
  title: string;
  type: string;
  scheduleState: string;
  parentId: string | null;
  parentKey: string | null;
  parentType: string | null;
  parentTitle: string | null;
  parentScheduleState: string | null;
  releaseId: string | null;
  releaseName: string | null;
  assigneeId: string | null;
  assigneeDisplayName: string | null;
  assigneeAvatarUrl: string | null;
  estimateHours: string | null;
  todoHours: string | null;
  actualHours: string | null;
  rank: string;
}