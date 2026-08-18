/**
 * FormField — label + input slot + optional hint/error.
 *
 * Eliminates the repeated `<div><label ...>{label}</label>{children}</div>`
 * pattern that was copy-pasted across every modal and detail panel.
 *
 * Usage:
 *   <FormField label="Name" required htmlFor="name">
 *     <Input id="name" value={name} onChange={...} />
 *   </FormField>
 */
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { Label } from './label'
import { BRAND } from '@/shared/config/brand'

interface FormFieldProps {
  /** Label text — accepts ReactNode for rich labels (e.g. inline code, bold key names) */
  label: ReactNode
  htmlFor?: string
  required?: boolean
  /** Small helper text rendered below the input */
  hint?: string
  /** Validation error — renders red text below the input */
  error?: string
  children: ReactNode
  className?: string
}

export function FormField({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="ml-0.5" style={{ color: BRAND.danger }} aria-hidden="true">
            *
          </span>
        )}
      </Label>
      {children}
      {hint && <p className="text-ui-xs text-foreground-subtle">{hint}</p>}
      {error && (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * A field slot that DISPLAYS an inherited value and offers no way to change it.
 *
 * For a field the record owns but this form does not: a Work Item's Project (WIC-FR-004 /
 * WID-FR-017 — auto-filled from the active Project context at creation, read-only everywhere
 * after), an inherited Iteration, a Task's Project (Task Management AC #14). It is an
 * input-shaped BOX rather than bare text on purpose — the value sits on the same baseline as
 * the editable fields around it, so a form reads as one grid of fields where one of them
 * happens to be fixed, instead of a caption floating beside inputs.
 *
 * It is a `<div>`, not a `disabled`/`readOnly` `<input>`: a disabled control still announces
 * itself as a control the user might enable, and there is no state in which this one becomes
 * editable. Nothing here takes an `onChange`, which is what makes "read-only" a property of
 * the component rather than of a prop a caller could pass differently.
 *
 * The class string was hand-rolled identically in two places before this — the Iteration Status Add
 * Item modal's local `roBox` (three fields) and the Work Item detail sidebar's Project field — and
 * the read-only Project context now needed it in three more, which is why it lives here.
 */
export function ReadOnlyFieldValue({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex h-9 min-w-0 items-center rounded border border-input bg-input-background px-3 text-ui-md text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}
