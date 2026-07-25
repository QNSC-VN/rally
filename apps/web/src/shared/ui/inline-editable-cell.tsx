import { useState } from 'react'
import { cn } from '@/shared/lib/utils'

interface InlineEditableCellProps {
  value: string
  onCommit: (value: string) => void
  canEdit: boolean
  displayValue?: React.ReactNode
  trigger?: 'click' | 'dblclick'
  className?: string
  style?: React.CSSProperties
  inputClassName?: string
  inputStyle?: React.CSSProperties
  ariaLabel?: string
  title?: string
  /**
   * Full-cell affordance (grid parity with SearchableSelect/DateField cell
   * variant): the hover box + click target + edit input span the whole cell
   * edge-to-edge. Requires the enclosing cell wrapper to be `px-0` (the editor
   * supplies its own px-2 py-1.5). Text alignment/font stays caller-controlled
   * via className/inputStyle (e.g. right-aligned mono for numeric columns).
   */
  fullCell?: boolean
}

/** Baked full-cell edit-input look — mirrors the other cell editors: subtle
 * border at rest, primary border on focus (input is auto-focused on open), and
 * the same px-2 py-1.5 as the hover affordance so entering edit never shifts
 * the row. Keep in sync with SearchableSelect/DateField cell variant. */
/* Full-cell edit input: 1px border is the edit cue; the global focus ring is
 * suppressed via `outline-none` (now that the base :focus-visible rule is
 * layered, this utility wins normally — no inline-style override needed). */
const FULL_CELL_INPUT =
  'w-full rounded border border-input bg-white px-2 py-1.5 text-inherit outline-none'

// ponytail: editing closes as soon as commit fires (not after the caller's
// mutation resolves) — the caller still owns validation/toast/revert, this
// just avoids the input lingering through an in-flight request.
export function InlineEditableCell({
  value,
  onCommit,
  canEdit,
  displayValue,
  trigger = 'click',
  className,
  style,
  inputClassName,
  inputStyle,
  ariaLabel,
  title,
  fullCell = false,
}: InlineEditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function startEdit() {
    if (!canEdit) return
    setDraft(value)
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    onCommit(draft)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  if (editing && canEdit) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') cancel()
        }}
        aria-label={ariaLabel}
        className={fullCell ? cn(FULL_CELL_INPUT, inputClassName) : inputClassName}
        style={inputStyle}
      />
    )
  }

  const triggerProps = trigger === 'dblclick' ? { onDoubleClick: startEdit } : { onClick: startEdit }

  // Editable cells get the shared hover affordance (outline box + text caret,
  // no layout shift); read-only cells render plain. `fullCell` adds the
  // edge-to-edge padding so the box/target fills the whole cell.
  const affordance = canEdit
    ? fullCell
      ? 'inline-edit-cell block w-full px-2 py-1.5'
      : 'inline-edit-cell'
    : fullCell
      ? 'block w-full px-2 py-1.5'
      : undefined
  const mergedClassName = cn(affordance, className) || undefined

  return (
    <span
      className={mergedClassName}
      style={{ cursor: canEdit ? 'pointer' : 'default', ...style }}
      title={title}
      {...triggerProps}
    >
      {displayValue ?? value}
    </span>
  )
}
