import { BRAND } from '@/shared/config/brand'
import type { StatusStyle } from '@/shared/config/status-colors'
import type { MilestoneStatus } from './api'

/**
 * Milestone status → badge colors. Single source of truth shared by the
 * milestones list page and the milestone detail page (previously duplicated).
 */
export const MILESTONE_STATUS_STYLE: Record<MilestoneStatus, StatusStyle> = {
  planned: { bg: '#eef3fb', text: BRAND.textSecondary, border: BRAND.border, label: 'Planned' },
  at_risk: { bg: '#fff7ed', text: '#9a3412', border: '#fed7aa', label: 'At Risk' },
  met: { bg: '#eaf5ed', text: '#1e6930', border: '#b9dec2', label: 'Met' },
  missed: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca', label: 'Missed' },
  cancelled: { bg: '#f1f5f9', text: BRAND.textSecondary, border: BRAND.border, label: 'Cancelled' },
  completed: { bg: '#eef6f0', text: '#1e6930', border: '#a8d5b3', label: 'Completed' },
}
