import * as React from 'react'

import { cn } from '@/shared/lib/utils'
import { FIELD_FOCUS_VISIBLE } from '@/shared/ui/field-focus'

/**
 * Rally-tuned Input — compact density, Rally border token, accessible focus ring.
 * Drop-in replacement for bare <input> in modals and detail panels.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'w-full rounded border border-input bg-white px-3 py-2 text-ui-md text-foreground transition-colors outline-none',
        'placeholder:text-muted-foreground',
        FIELD_FOCUS_VISIBLE,
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input-background disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
