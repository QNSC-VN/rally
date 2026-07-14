import type { StateStep } from './state-steps'

// ── Rally-style segmented state stepper ─────────────────────────────────────
// One box per step, filled up to the current step, the active box solid with
// its letter. Single source of truth for the state column across every
// work-item grid (iteration status, backlog, team status) so the whole app
// speaks one visual language. Step data lives in ./state-steps.

const STEPPER_BORDER = '#e8e8e8'
const STEPPER_REACHED = '#edf2fb'
const STEPPER_SEP = '#ffffff'

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
      className="flex w-full overflow-hidden rounded"
      style={{ border: `1px solid ${STEPPER_BORDER}`, height: 20 }}
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
              flex: 1,
              minWidth: 0,
              border: 'none',
              borderLeft: i > 0 ? `1px solid ${STEPPER_SEP}` : 'none',
              padding: 0,
              fontSize: 9,
              fontWeight: 700,
              lineHeight: '18px',
              cursor: canEdit && !isCurrent ? 'pointer' : 'default',
              backgroundColor: isCurrent ? step.activeBg : reached ? STEPPER_REACHED : '#ffffff',
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
