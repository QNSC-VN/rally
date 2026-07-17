/**
 * NativeSelect — Rally-styled wrapper around <select>.
 * Provides the same visual token system as Input/Textarea:
 * border-input, focus-visible ring, bg-white, text-[12px].
 *
 * Usage:
 *   <NativeSelect value={v} onChange={e => setV(e.target.value)}>
 *     <option value="a">Option A</option>
 *   </NativeSelect>
 */
import { BRAND } from '@/shared/config/brand'
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
          'w-full cursor-pointer rounded border border-input bg-white px-3 py-2 text-[12px] text-foreground transition-colors outline-none',
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
          'w-full cursor-pointer rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-foreground transition-colors outline-none',
          'hover:border-input hover:bg-white',
          'focus-visible:border-ring focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-ring/50',
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
}

export const InlineCellSelect = forwardRef<HTMLSelectElement, InlineCellSelectProps>(
  ({ className, children, displayValue, muted, ...props }, ref) => {
    return (
      <div
        className={cn(
          'relative flex w-full cursor-pointer items-center overflow-hidden rounded border border-transparent transition-colors',
          'hover:border-input hover:bg-white',
          props.disabled && 'cursor-not-allowed opacity-60',
          className,
        )}
      >
        <span className="pointer-events-none flex min-w-0 flex-1 items-center gap-0.5 px-1 py-0.5">
          <span
            className="min-w-0 flex-1 truncate text-[11px]"
            style={{ color: muted ? BRAND.textDisabled : 'inherit' }}
          >
            {displayValue}
          </span>
          <ChevronDown size={9} className="shrink-0" style={{ color: BRAND.textMuted }} />
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
