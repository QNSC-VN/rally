import { useState } from 'react'

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
}

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
        className={inputClassName}
        style={inputStyle}
      />
    )
  }

  const triggerProps = trigger === 'dblclick' ? { onDoubleClick: startEdit } : { onClick: startEdit }

  // Editable cells get the shared hover affordance (outline box + text caret,
  // no layout shift); read-only cells render plain.
  const affordance = canEdit ? 'inline-edit-cell' : undefined
  const mergedClassName = [affordance, className].filter(Boolean).join(' ') || undefined

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
