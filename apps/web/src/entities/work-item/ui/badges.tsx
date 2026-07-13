import {
  BADGE_FALLBACK,
  SCHEDULE_STATE_CONFIG,
  SCHEDULE_STATE_LABEL,
  WORK_ITEM_PRIORITY_CONFIG,
  WORK_ITEM_TYPE_CONFIG,
  type ScheduleState,
  type WorkItemPriority,
  type WorkItemType,
} from '@/entities/work-item/model/types'

// ── TypeBadge ─────────────────────────────────────────────────────────────────

interface TypeBadgeProps {
  type: WorkItemType | string
}

export function TypeBadge({ type }: TypeBadgeProps) {
  const cfg = WORK_ITEM_TYPE_CONFIG[type as WorkItemType] ?? {
    label: type.slice(0, 2).toUpperCase(),
    ...BADGE_FALLBACK,
  }
  const Icon = cfg.icon
  return (
    <span
      className="inline-flex h-5 min-w-[36px] items-center justify-center gap-0.5 rounded-sm px-1.5 text-[9px] font-semibold"
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
    >
      {Icon && <Icon size={10} strokeWidth={2.2} />}
      {cfg.label}
    </span>
  )
}

// ── StatusBadge (Schedule State) ──────────────────────────────────────────────

interface ScheduleStateBadgeProps {
  state: ScheduleState | string
  /** Render a small leading color dot instead of the tinted background pill. */
  dot?: boolean
}

export function ScheduleStateBadge({ state, dot }: ScheduleStateBadgeProps) {
  const cfg = SCHEDULE_STATE_CONFIG[state as ScheduleState] ?? BADGE_FALLBACK
  const label = SCHEDULE_STATE_LABEL[state as ScheduleState] ?? state
  if (dot) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-sm px-2 py-px text-[11px] font-medium whitespace-nowrap"
        style={{ backgroundColor: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}33` }}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: cfg.color }} />
        {label}
      </span>
    )
  }
  return (
    <span
      className="inline-flex h-5 items-center rounded-sm px-1.5 text-[10px] font-medium"
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
    >
      {label}
    </span>
  )
}

// ── PriorityBadge ─────────────────────────────────────────────────────────────

interface PriorityBadgeProps {
  priority: WorkItemPriority | string
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  const cfg = WORK_ITEM_PRIORITY_CONFIG[priority as WorkItemPriority] ?? {
    label: priority,
    color: '#5c6478',
  }
  return (
    <span className="text-[10px] font-medium" style={{ color: cfg.color }}>
      {cfg.label}
    </span>
  )
}
