/**
 * NativeSelect — Rally-styled wrapper around <select>.
 * Provides the same visual token system as Input/Textarea:
 * border-input, focus-visible ring, bg-card, text-ui-md.
 *
 * Usage:
 *   <NativeSelect value={v} onChange={e => setV(e.target.value)}>
 *     <option value="a">Option A</option>
 *   </NativeSelect>
 */
import { forwardRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  className?: string
}

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'w-full cursor-pointer rounded border border-input bg-card px-3 py-2 text-ui-md text-foreground transition-colors outline-none',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:bg-input-background disabled:opacity-60',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    )
  },
)
NativeSelect.displayName = 'NativeSelect'

/** Compact variant for inline table-cell selects (h-7, no border visible at rest) */
export const InlineSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'w-full cursor-pointer rounded border border-transparent bg-transparent px-1 py-0.5 text-ui-sm text-foreground transition-colors outline-none',
          'hover:border-input hover:bg-card',
          'focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    )
  },
)
InlineSelect.displayName = 'InlineSelect'

/**
 * InlineCellSelect — Table-cell inline select with proper text truncation.
 *
 * Uses an overlay pattern: a visible <span> shows the truncated display value
 * with ellipsis, while an invisible <select> sits on top to handle interaction.
 * This ensures long option text always fits within the cell width in all browsers.
 */
export interface InlineCellSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  displayValue: string
  muted?: boolean
  /** Optional leading node (e.g. an owner initials chip) rendered before the value. */
  leading?: React.ReactNode
}

export const InlineCellSelect = forwardRef<HTMLSelectElement, InlineCellSelectProps>(
  ({ className, children, displayValue, muted, leading, ...props }, ref) => {
    return (
      <div
        className={cn(
          'relative flex w-full cursor-pointer items-center overflow-hidden rounded border border-transparent transition-colors',
          'hover:border-input hover:bg-card',
          props.disabled && 'cursor-not-allowed opacity-60',
          className,
        )}
      >
        <span className="pointer-events-none flex min-w-0 flex-1 items-center gap-1 px-1 py-0.5">
          {leading}
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-ui-sm',
              muted && 'text-foreground-disabled',
            )}
          >
            {displayValue}
          </span>
          <ChevronDown size={9} className="shrink-0 text-foreground-subtle" />
        </span>
        <select
          ref={ref}
          className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...props}
        >
          {children}
        </select>
      </div>
    )
  },
)
InlineCellSelect.displayName = 'InlineCellSelect'
