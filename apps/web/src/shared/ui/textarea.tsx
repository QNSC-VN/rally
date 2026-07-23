import * as React from 'react'

import { cn } from '@/shared/lib/utils'
import { FIELD_FOCUS_VISIBLE } from '@/shared/ui/field-focus'

/**
 * Rally-tuned Textarea — compact density, resize-none by default, Rally border token.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'w-full resize-none rounded border border-input bg-white px-3 py-2 text-ui-md text-foreground transition-colors outline-none',
        'placeholder:text-muted-foreground',
        FIELD_FOCUS_VISIBLE,
        'disabled:cursor-not-allowed disabled:bg-input-background disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
