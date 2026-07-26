import { useState } from 'react'
import { BRAND } from '@/shared/config/brand'
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
//
// Interactive (canEdit + onChange): hovering a box previews the transition —
// the track fills up to the hovered box and it lights up with that state's
// letter — and its tooltip reads "Move to <State>". Clicking commits it. This
// is the live, hover-to-preview control from Rally, not a static badge.

const CELL = 16

export function StateStepper<T extends string>({
  steps,
  value,
  canEdit,
  onChange,
  ariaLabel,
  blocked = false,
}: {
  steps: StateStep<T>[]
  value: T
  canEdit: boolean
  /** Omit for a read-only stepper (summary grids). */
  onChange?: (next: T) => void
  ariaLabel?: string
  /** When true, the track turns red — the item is blocked (mirrors Rally). */
  blocked?: boolean
}) {
  // Blocked flips the whole track from the blue progress scale to red, so a
  // blocked item reads as red at a glance (matches the Blocked column).
  const STEPPER_BORDER = blocked ? BRAND.dangerBorder : BRAND.accentBorderStrong
  const STEPPER_REACHED = blocked ? BRAND.dangerBg : BRAND.accentBorder
  const STEPPER_CURRENT = blocked ? BRAND.danger : BRAND.primaryLight
  const STEPPER_SEP = STEPPER_BORDER

  const [hovered, setHovered] = useState<number | null>(null)
  const idx = steps.findIndex((s) => s.value === value)
  const interactive = canEdit && !!onChange
  // While hovering an actionable box, colour the track as if the item were
  // already there — a live preview of the move.
  const activeIdx = interactive && hovered !== null ? hovered : idx

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded-[2px]"
      style={{ border: `1px solid ${STEPPER_BORDER}`, height: CELL }}
      onMouseLeave={() => setHovered(null)}
    >
      {steps.map((step, i) => {
        const isCurrent = i === idx
        const isActive = i === activeIdx
        const reached = i < activeIdx
        const actionable = interactive && !isCurrent
        return (
          <button
            key={step.value}
            type="button"
            title={actionable ? `Move to ${step.label}` : step.label}
            disabled={!actionable}
            onMouseEnter={actionable ? () => setHovered(i) : undefined}
            onClick={actionable ? () => onChange!(step.value) : undefined}
            style={{
              width: CELL,
              flex: 'none',
              border: 'none',
              borderLeft: i > 0 ? `1px solid ${STEPPER_SEP}` : 'none',
              padding: 0,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: `${CELL - 2}px`,
              cursor: actionable ? 'pointer' : 'default',
              backgroundColor: isActive
                ? STEPPER_CURRENT
                : reached
                  ? STEPPER_REACHED
                  : BRAND.surface,
              color: isActive ? BRAND.surface : 'transparent',
              transition: 'background-color 120ms',
            }}
          >
            {isActive ? steps[activeIdx].letter : ''}
          </button>
        )
      })}
    </div>
  )
}
