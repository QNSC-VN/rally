import { BRAND } from '@/shared/config/brand'
import type { StatusStyle } from '@/shared/config/status-colors'
import type { MilestoneStatus } from './api'

/**
 * Milestone status → badge colors. Single source of truth shared by the
 * milestones list page and the milestone detail page (previously duplicated).
 */
export const MILESTONE_STATUS_STYLE: Record<MilestoneStatus, StatusStyle> = {
  planned: { bg: '#eef3fb', text: BRAND.textSecondary, border: BRAND.border, label: 'Planned' },
  at_risk: {
    bg: BRAND.warningBg,
    text: BRAND.warning,
    border: BRAND.warningBorder,
    label: 'At Risk',
  },
  met: { bg: '#eaf5ed', text: '#1e6930', border: BRAND.successBorder, label: 'Met' },
  missed: { bg: '#fef2f2', text: '#b91c1c', border: BRAND.dangerBorder, label: 'Missed' },
  cancelled: { bg: '#f1f5f9', text: BRAND.textSecondary, border: BRAND.border, label: 'Cancelled' },
  completed: { bg: '#eef6f0', text: '#1e6930', border: '#a8d5b3', label: 'Completed' },
}
