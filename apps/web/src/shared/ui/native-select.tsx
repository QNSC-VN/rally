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
import { forwardRef } from 'react'
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
          'w-full cursor-pointer rounded border border-input bg-white px-3 py-2 text-[12px] text-foreground outline-none transition-colors',
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
          'w-full cursor-pointer rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-foreground outline-none transition-colors',
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
