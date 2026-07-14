import {
  SCHEDULE_STATE_CONFIG,
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
  ScheduleState,
  SIMPLIFIED_STATE_CONFIG,
  SIMPLIFIED_STATE_LABEL,
  SIMPLIFIED_STATE_ORDER,
  SIMPLIFIED_STATE_TO_SCHEDULE_STATE,
} from '@/entities/work-item/model/types'

// ── Segmented state-stepper step definitions ────────────────────────────────
// Presentation data (letter + active-box color) for the shared StateStepper.
// Single source of truth so every work-item grid renders the same segments.

export interface StateStep<T extends string = string> {
  value: T
  label: string
  /** Single-character abbreviation shown on the active box. */
  letter: string
  /** Background of the active box. */
  activeBg: string
}

const SCHEDULE_STATE_ABBR: Record<ScheduleState, string> = {
  [ScheduleState.Idea]: 'I',
  [ScheduleState.Defined]: 'D',
  [ScheduleState.Ready]: 'R',
  [ScheduleState.InProgress]: 'P',
  [ScheduleState.Completed]: 'C',
  [ScheduleState.Accepted]: 'A',
  [ScheduleState.Released]: 'L',
}

/** Story/defect-level steps — every canonical schedule state. */
export const SCHEDULE_STATE_STEPS: StateStep<ScheduleState>[] = SCHEDULE_STATE_VALUES.map((s) => ({
  value: s,
  label: SCHEDULE_STATE_LABEL[s],
  letter: SCHEDULE_STATE_ABBR[s],
  activeBg: SCHEDULE_STATE_CONFIG[s].color,
}))

/**
 * Task-level steps — collapsed to the 3 simplified states, each emitting the
 * canonical schedule state it maps to.
 */
export const SIMPLIFIED_STATE_STEPS: StateStep<ScheduleState>[] = SIMPLIFIED_STATE_ORDER.map(
  (s) => ({
    value: SIMPLIFIED_STATE_TO_SCHEDULE_STATE[s],
    label: SIMPLIFIED_STATE_LABEL[s],
    letter: SIMPLIFIED_STATE_LABEL[s].charAt(0).toUpperCase(),
    activeBg: SIMPLIFIED_STATE_CONFIG[s].activeBg,
  }),
)
