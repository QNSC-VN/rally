// ── Const objects (replaces enums for erasableSyntaxOnly compat) ─────────────

export const WorkItemType = {
  Initiative: 'initiative',
  Feature: 'feature',
  Story: 'story',
  Task: 'task',
  Defect: 'defect',
} as const
export type WorkItemType = (typeof WorkItemType)[keyof typeof WorkItemType]

/** Schedule State — business readiness dimension (BA design §P1-05) */
export const ScheduleState = {
  Idea: 'idea',
  Defined: 'defined',
  InProgress: 'in_progress',
  Completed: 'completed',
  Accepted: 'accepted',
  Released: 'released',
} as const
export type ScheduleState = (typeof ScheduleState)[keyof typeof ScheduleState]

export const WorkItemPriority = {
  None: 'none',
  Low: 'low',
  Normal: 'normal',
  High: 'high',
  Urgent: 'urgent',
} as const
export type WorkItemPriority = (typeof WorkItemPriority)[keyof typeof WorkItemPriority]

export const ProjectStatus = {
  Active: 'active',
  Archived: 'archived',
} as const
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus]

// ── Derived arrays (DRY — do not duplicate these in pages/features) ───────────

/** All schedule state values in display order. */
export const SCHEDULE_STATE_VALUES = Object.values(ScheduleState) as ScheduleState[]

/** All priority values in display order. */
export const PRIORITY_VALUES = Object.values(WorkItemPriority) as WorkItemPriority[]

// ── Style config maps ─────────────────────────────────────────────────────────

export interface BadgeStyle {
  label: string
  color: string
  bg: string
}

export const WORK_ITEM_TYPE_CONFIG: Record<WorkItemType, BadgeStyle> = {
  [WorkItemType.Initiative]: { label: 'IN', color: '#059669', bg: '#ecfdf5' },
  [WorkItemType.Feature]:    { label: 'FE', color: '#7c3aed', bg: '#f3effd' },
  [WorkItemType.Story]:      { label: 'US', color: '#2558a6', bg: '#eef3fb' },
  [WorkItemType.Task]:       { label: 'TA', color: '#1d3f73', bg: '#e5ebf4' },
  [WorkItemType.Defect]:     { label: 'DE', color: '#b91c1c', bg: '#fef2f2' },
}

export const SCHEDULE_STATE_LABEL: Record<ScheduleState, string> = {
  [ScheduleState.Idea]:       'Idea',
  [ScheduleState.Defined]:    'Defined',
  [ScheduleState.InProgress]: 'In Progress',
  [ScheduleState.Completed]:  'Completed',
  [ScheduleState.Accepted]:   'Accepted',
  [ScheduleState.Released]:   'Released',
}

export interface StatusBadgeStyle {
  color: string
  bg: string
}

export const SCHEDULE_STATE_CONFIG: Record<ScheduleState, StatusBadgeStyle> = {
  [ScheduleState.Idea]:       { color: '#6b7280', bg: '#f3f4f6' },
  [ScheduleState.Defined]:    { color: '#5c6478', bg: '#edf0f4' },
  [ScheduleState.InProgress]: { color: '#1d6f9e', bg: '#e5f2fb' },
  [ScheduleState.Completed]:  { color: '#3d7a4e', bg: '#eef6f0' },
  [ScheduleState.Accepted]:   { color: '#1e6930', bg: '#eaf5ed' },
  [ScheduleState.Released]:   { color: '#7c3aed', bg: '#f3effd' },
}

export interface PriorityStyle {
  label: string
  color: string
}

export const WORK_ITEM_PRIORITY_CONFIG: Record<WorkItemPriority, PriorityStyle> = {
  [WorkItemPriority.None]:   { label: '—',      color: '#9ca3af' },
  [WorkItemPriority.Low]:    { label: 'Low',    color: '#8c94a6' },
  [WorkItemPriority.Normal]: { label: 'Normal', color: '#5c6478' },
  [WorkItemPriority.High]:   { label: 'High',   color: '#d97706' },
  [WorkItemPriority.Urgent]: { label: 'Urgent', color: '#b91c1c' },
}

// ── Fallback style ────────────────────────────────────────────────────────────
export const BADGE_FALLBACK: StatusBadgeStyle = { color: '#5c6478', bg: '#edf0f4' }
