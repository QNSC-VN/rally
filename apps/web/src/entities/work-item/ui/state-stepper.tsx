import type { StateStep } from './state-steps'

// ── Rally-style segmented state stepper ─────────────────────────────────────
// One box per step, filled up to the current step, the active box solid with
// its letter. Single source of truth for the state column across every
// work-item grid (iteration status, backlog, team status) so the whole app
// speaks one visual language. Step data lives in ./state-steps.
//
// Colours mirror Broadcom Rally: a uniform blue scale (soft blue for states
// already passed, solid blue for the current state) rather than per-state
// hues, so the control reads as one progress track at a glance. Cells are
// fixed-size squares packed left-to-right (not stretched to the column) so the
// track reads as discrete steps; every square — including empty future ones —
// is outlined with the same visible border so the whole set reads as a
// countable row of squares, exactly like the Rally state control.

const STEPPER_BORDER = '#9db4d4'
const STEPPER_REACHED = '#bcd3ef'
const STEPPER_CURRENT = '#2558a6'
const STEPPER_SEP = '#9db4d4'
const CELL = 16

export function StateStepper<T extends string>({
  steps,
  value,
  canEdit,
  onChange,
  ariaLabel,
}: {
  steps: StateStep<T>[]
  value: T
  canEdit: boolean
  onChange: (next: T) => void
  ariaLabel?: string
}) {
  const idx = steps.findIndex((s) => s.value === value)
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded-[2px]"
      style={{ border: `1px solid ${STEPPER_BORDER}`, height: CELL }}
    >
      {steps.map((step, i) => {
        const isCurrent = i === idx
        const reached = i < idx
        return (
          <button
            key={step.value}
            type="button"
            title={step.label}
            disabled={!canEdit || isCurrent}
            onClick={canEdit && !isCurrent ? () => onChange(step.value) : undefined}
            style={{
              width: CELL,
              flex: 'none',
              border: 'none',
              borderLeft: i > 0 ? `1px solid ${STEPPER_SEP}` : 'none',
              padding: 0,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: `${CELL - 2}px`,
              cursor: canEdit && !isCurrent ? 'pointer' : 'default',
              backgroundColor: isCurrent ? STEPPER_CURRENT : reached ? STEPPER_REACHED : '#ffffff',
              color: isCurrent ? '#ffffff' : 'transparent',
            }}
          >
            {isCurrent ? step.letter : ''}
          </button>
        )
      })}
    </div>
  )
}
