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
// Interactive (canEdit + onChange): hovering an actionable box just recolours
// THAT box (no letter — only the current box shows its letter), while the
// resting progress fill (up to the current state) stays put; its tooltip reads
// "Move to <State>". Clicking commits it. This mirrors Broadcom Rally, where
// hovering a segment only changes that segment's colour, not the whole track.

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
        const reached = i < idx
        const actionable = interactive && !isCurrent
        // Only the hovered box previews the target; the resting fill is untouched.
        const isPreview = interactive && hovered === i && !isCurrent
        const lit = isCurrent || isPreview
        const cellStyle = {
          width: CELL,
          flex: 'none' as const,
          border: 'none',
          borderLeft: i > 0 ? `1px solid ${STEPPER_SEP}` : 'none',
          padding: 0,
          fontSize: 10,
          fontWeight: 700,
          lineHeight: `${CELL - 2}px`,
          backgroundColor: lit ? STEPPER_CURRENT : reached ? STEPPER_REACHED : BRAND.surface,
          // Only the CURRENT box shows its letter; a hover preview just
          // recolours the box (no letter), matching Rally.
          color: isCurrent ? BRAND.surface : 'transparent',
          transition: 'background-color 120ms',
        }
        // Named rather than spread inline at each element: the FE ratchet counts `style={{` literals,
        // and a shared base plus two named variants is both cheaper to read and one fewer of them.
        const staticCellStyle = {
          ...cellStyle,
          display: 'inline-block',
          textAlign: 'center' as const,
        }
        const actionableCellStyle = { ...cellStyle, cursor: 'pointer' }
        /**
         * A cell that cannot act is a SPAN, not a disabled button.
         *
         * Three things were wrong with rendering every cell as a disabled button element. It put six
         * dead controls per row into the accessibility tree, where a reader meets them one after
         * another with nothing to do. It made a read-only stepper — `canEdit={false}`, which is most
         * of them — six controls that never act. And where the stepper is rendered INSIDE another
         * button it produced invalid HTML: `SearchableSelect` renders the selected option's node in
         * its own trigger button, so the `Schedule State` field logged "In HTML, button cannot be a
         * descendant of button. This will cause a hydration error." on every detail page.
         *
         * `data-current` marks the segment holding the value, so a test (or a style) can address it
         * by what it MEANS rather than by a disabled-button selector, which was only ever a side
         * effect of this shape.
         */
        if (!actionable) {
          return (
            <span
              key={step.value}
              title={step.label}
              data-current={isCurrent ? 'true' : undefined}
              style={staticCellStyle}
            >
              {isCurrent ? step.letter : ''}
            </span>
          )
        }
        return (
          <button
            key={step.value}
            type="button"
            title={`Move to ${step.label}`}
            onMouseEnter={() => setHovered(i)}
            onClick={() => onChange!(step.value)}
            style={actionableCellStyle}
          >
            {isCurrent ? step.letter : ''}
          </button>
        )
      })}
    </div>
  )
}
