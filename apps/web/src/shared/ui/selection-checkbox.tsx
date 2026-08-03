/**
 * SelectionCheckbox — the standard row / header checkbox for selectable tables.
 *
 * Wraps a native checkbox with Rally's brand accent and imperative
 * `indeterminate` support (the header uses it to show a partial selection).
 * Shared by Backlog and Iteration Status so the control looks and behaves
 * identically everywhere.
 */
import { BRAND } from '@/shared/config/brand'
import { useEffect, useRef } from 'react'
import { cn } from '@/shared/lib/utils'

interface SelectionCheckboxProps {
  checked: boolean
  /** Show the partial (dash) state — only visible when `checked` is false. */
  indeterminate?: boolean
  onChange: () => void
  /** Required for a11y — e.g. "Select all" or "Select PROJ-123". */
  ariaLabel: string
  /**
   * Un-tickable, for a row that is shown but cannot be chosen.
   *
   * Capacity's Feature picker needs it: a Feature already in the selected Team stays listed and
   * disabled rather than disappearing (SRS §247).
   */
  disabled?: boolean
  className?: string
}

export function SelectionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
  disabled,
  className,
}: SelectionCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked
  }, [indeterminate, checked])

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className={cn(
        'h-3.5 w-3.5 rounded',
        disabled ? 'cursor-default' : 'cursor-pointer',
        className,
      )}
      style={{ accentColor: BRAND.primary }}
      aria-label={ariaLabel}
    />
  )
}
