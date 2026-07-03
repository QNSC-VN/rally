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
      {hint && (
        <p className="text-[10px]" style={{ color: BRAND.textMuted }}>
          {hint}
        </p>
      )}
      {error && (
        <p className="text-[11px]" style={{ color: BRAND.danger }}>
          {error}
        </p>
      )}
    </div>
  )
}
