import { BRAND } from '@/shared/config/brand'
import {
  WorkItemPriority,
  DEFECT_SEVERITY_CONFIG,
  DEFECT_SEVERITY_OPTIONS,
  PRIORITY_LABEL,
  SCHEDULE_STATE_VALUES,
  SCHEDULE_STATE_LABEL,
} from '@/entities/work-item/model/types'

export type QualityColKey =
  | 'id'
  | 'name'
  | 'userStory'
  | 'severity'
  | 'priority'
  | 'state'
  | 'flowState'
  | 'fixedInBuild'
  | 'iteration'
  | 'submittedBy'
  | 'owner'

export interface QualityCtx {
  canManage: boolean
  projectId: string
  openItem: (itemKey: string) => void
}

/** Severity labels/colours + option list come from the shared entity config. */
export const SEVERITY_STYLE = DEFECT_SEVERITY_CONFIG
export const SEVERITY_OPTIONS = DEFECT_SEVERITY_OPTIONS

/** Flow State (schedule state) options — derived from the shared entity config
 * so the defect page can never drift from the canonical schedule-state set. */
export const FLOW_STATE_OPTIONS: { value: string; label: string }[] = SCHEDULE_STATE_VALUES.map(
  (v) => ({ value: v, label: SCHEDULE_STATE_LABEL[v] }),
)

// Labels sourced from the shared work-item config (single source of truth);
// order is defect-page specific (most-urgent first).
export const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  WorkItemPriority.None,
  WorkItemPriority.Urgent,
  WorkItemPriority.High,
  WorkItemPriority.Normal,
  WorkItemPriority.Low,
].map((v) => ({ value: v, label: PRIORITY_LABEL[v] }))

export const DEFECT_STATE_STYLE: Record<
  string,
  { bg: string; text: string; border: string; label: string }
> = {
  submitted: {
    bg: BRAND.primaryLighter,
    text: BRAND.primaryLight,
    border: BRAND.primaryLighter,
    label: 'Submitted',
  },
  open: { bg: BRAND.warningBg, text: BRAND.warning, border: BRAND.warningBorder, label: 'Open' },
  fixed: { bg: BRAND.successBg, text: BRAND.success, border: BRAND.successBorder, label: 'Fixed' },
  closed: {
    bg: BRAND.primaryLighter,
    text: BRAND.textSecondary,
    border: BRAND.border,
    label: 'Closed',
  },
  closed_declined: {
    bg: BRAND.dangerBg,
    text: BRAND.danger,
    border: BRAND.dangerBorder,
    label: 'Closed Declined',
  },
}

export const DEFECT_STATE_OPTIONS: { value: string; label: string }[] = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'open', label: 'Open' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'closed', label: 'Closed' },
  { value: 'closed_declined', label: 'Closed Declined' },
]

// Mirrors the backend defect state machine (work-items.service.ts, SRS §6):
// Submitted → Open → Fixed → Closed, and Submitted/Open → Closed Declined.
export const DEFECT_TRANSITIONS: Record<string, string[]> = {
  submitted: ['open', 'closed_declined'],
  open: ['fixed', 'closed_declined'],
  fixed: ['closed'],
  closed: [],
  closed_declined: [],
}
