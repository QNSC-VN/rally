import { BRAND } from '@/shared/config/brand'
import type { LucideIcon } from 'lucide-react'
import { BookOpen, Target, Layers, ClipboardList, Bug } from 'lucide-react'

// ── Const objects (replaces enums for erasableSyntaxOnly compat) ─────────────

export const WorkItemType = {
  Initiative: 'initiative',
  Feature: 'feature',
  Story: 'story',
  Task: 'task',
  Defect: 'defect',
} as const
export type WorkItemType = (typeof WorkItemType)[keyof typeof WorkItemType]

/** Schedule State — business readiness dimension (BA design §P1-05).
 * Aligned to BA flow-state vocabulary: 6 states, terminal state 'release'. */
export const ScheduleState = {
  Idea: 'idea',
  Defined: 'defined',
  InProgress: 'in_progress',
  Completed: 'completed',
  Accepted: 'accepted',
  Release: 'release',
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
  icon?: LucideIcon
}

export const WORK_ITEM_TYPE_CONFIG: Record<WorkItemType, BadgeStyle> = {
  [WorkItemType.Initiative]: { label: 'IN', color: '#059669', bg: '#ecfdf5', icon: Target },
  [WorkItemType.Feature]: { label: 'FE', color: '#7c3aed', bg: '#f3effd', icon: Layers },
  [WorkItemType.Story]: { label: 'US', color: '#2558a6', bg: '#eef3fb', icon: BookOpen },
  [WorkItemType.Task]: { label: 'TA', color: '#1d3f73', bg: '#e5ebf4', icon: ClipboardList },
  [WorkItemType.Defect]: { label: 'DE', color: '#b91c1c', bg: '#fef2f2', icon: Bug },
}

export const SCHEDULE_STATE_LABEL: Record<ScheduleState, string> = {
  [ScheduleState.Idea]: 'Idea',
  [ScheduleState.Defined]: 'Defined',
  [ScheduleState.InProgress]: 'In Progress',
  [ScheduleState.Completed]: 'Completed',
  [ScheduleState.Accepted]: 'Accepted',
  [ScheduleState.Release]: 'Release',
}

/**
 * Human-readable, proper-cased priority labels for dropdowns/menus.
 * Single source of truth — do not hand-capitalize raw enum values in pages.
 * (The badge uses WORK_ITEM_PRIORITY_CONFIG.label which renders "—" for None;
 * selectable lists should show the word "None" instead.)
 */
export const PRIORITY_LABEL: Record<WorkItemPriority, string> = {
  [WorkItemPriority.None]: 'None',
  [WorkItemPriority.Low]: 'Low',
  [WorkItemPriority.Normal]: 'Normal',
  [WorkItemPriority.High]: 'High',
  [WorkItemPriority.Urgent]: 'Urgent',
}

export interface StatusBadgeStyle {
  color: string
  bg: string
}

export const SCHEDULE_STATE_CONFIG: Record<ScheduleState, StatusBadgeStyle> = {
  [ScheduleState.Idea]: { color: BRAND.textSecondary, bg: '#f3f4f6' },
  [ScheduleState.Defined]: { color: '#5c6478', bg: '#edf0f4' },
  [ScheduleState.InProgress]: { color: BRAND.primaryLight, bg: '#e5f2fb' },
  [ScheduleState.Completed]: { color: '#3d7a4e', bg: '#eef6f0' },
  [ScheduleState.Accepted]: { color: '#1e6930', bg: '#eaf5ed' },
  [ScheduleState.Release]: { color: '#7c3aed', bg: '#f3effd' },
}

export interface PriorityStyle {
  label: string
  color: string
}

export const WORK_ITEM_PRIORITY_CONFIG: Record<WorkItemPriority, PriorityStyle> = {
  [WorkItemPriority.None]: { label: '—', color: BRAND.textMuted },
  [WorkItemPriority.Low]: { label: 'Low', color: '#8c94a6' },
  [WorkItemPriority.Normal]: { label: 'Normal', color: '#5c6478' },
  [WorkItemPriority.High]: { label: 'High', color: '#d97706' },
  [WorkItemPriority.Urgent]: { label: 'Urgent', color: '#b91c1c' },
}

// ── Defect severity (SRS labels + colour) ─────────────────────────────────────
// Single source of truth for defect severity — do not re-declare these labels or
// colours in pages/features. Rendered by <SeverityBadge/>; option lists derive
// from DEFECT_SEVERITY_OPTIONS.
export type DefectSeverity = 'critical' | 'major' | 'minor' | 'trivial' | 'none'

export interface SeverityStyle {
  label: string
  color: string
  bg: string
  border: string
}

export const DEFECT_SEVERITY_CONFIG: Record<DefectSeverity, SeverityStyle> = {
  critical: { label: 'Critical', color: '#b91c1c', bg: '#fef2f2', border: BRAND.dangerBorder },
  major: {
    label: 'Major Problem',
    color: BRAND.warning,
    bg: BRAND.warningBg,
    border: BRAND.warningBorder,
  },
  minor: { label: 'Minor Problem', color: '#854d0e', bg: '#fefce8', border: '#fef08a' },
  trivial: { label: 'Trivial', color: BRAND.textSecondary, bg: '#f1f5f9', border: BRAND.border },
  none: { label: 'None', color: '#8c94a6', bg: '#f1f5f9', border: '#e2e6eb' },
}

/** Selectable severity options (value + SRS label) derived from the config. */
export const DEFECT_SEVERITY_OPTIONS: { value: DefectSeverity; label: string }[] = (
  Object.keys(DEFECT_SEVERITY_CONFIG) as DefectSeverity[]
).map((value) => ({ value, label: DEFECT_SEVERITY_CONFIG[value].label }))

// ── Fallback style ────────────────────────────────────────────────────────────
export const BADGE_FALLBACK: StatusBadgeStyle = { color: '#5c6478', bg: '#edf0f4' }

// ── Simplified 3-state model (Track pages: Define / In Progress / Complete) ────
// Iteration Status and Team Status both collapse the 6 ScheduleStates (or their
// own task-state enum) down to these 3 buckets for their task rows — shared here
// so both pages render the same colors instead of hand-rolling their own.

export type SimplifiedState = 'define' | 'in_progress' | 'complete'

export const SIMPLIFIED_STATE_LABEL: Record<SimplifiedState, string> = {
  define: 'Define',
  in_progress: 'In Progress',
  complete: 'Complete',
}

export interface SimplifiedStateStyle extends StatusBadgeStyle {
  /** Background used when this state is the active/selected segment of a control. */
  activeBg: string
}

export const SIMPLIFIED_STATE_CONFIG: Record<SimplifiedState, SimplifiedStateStyle> = {
  define: { color: '#5c6478', bg: '#edf0f4', activeBg: '#4a5568' },
  in_progress: { color: BRAND.primaryLight, bg: '#e5f2fb', activeBg: '#1a5c8a' },
  complete: { color: '#3d7a4e', bg: '#eef6f0', activeBg: '#2d603c' },
}

/** Ordered left-to-right, as rendered in the segmented control. */
export const SIMPLIFIED_STATE_ORDER: SimplifiedState[] = ['define', 'in_progress', 'complete']

const SIMPLIFIED_STATE_GROUPS: Record<SimplifiedState, ScheduleState[]> = {
  define: [ScheduleState.Idea, ScheduleState.Defined],
  in_progress: [ScheduleState.InProgress],
  complete: [ScheduleState.Completed, ScheduleState.Accepted, ScheduleState.Release],
}

export function getSimplifiedState(state: ScheduleState): SimplifiedState {
  for (const key of SIMPLIFIED_STATE_ORDER) {
    if (SIMPLIFIED_STATE_GROUPS[key].includes(state)) return key
  }
  return 'define'
}

/** Representative canonical ScheduleState written back to the API when a
 * simplified rectangle is clicked (tasks don't use idea/accepted/released). */
export const SIMPLIFIED_STATE_TO_SCHEDULE_STATE: Record<SimplifiedState, ScheduleState> = {
  define: ScheduleState.Defined,
  in_progress: ScheduleState.InProgress,
  complete: ScheduleState.Completed,
}
