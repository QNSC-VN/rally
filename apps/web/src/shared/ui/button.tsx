import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/shared/lib/utils'

/**
 * Button — the single source of truth for the app's button styling.
 *
 * Encodes the de-facto enterprise spec (compact 12px, navy primary, 4px radius)
 * as dark-mode-aware Tailwind classes backed by the semantic design tokens in
 * globals.css. Prefer this over hand-rolled `<button style={{ backgroundColor:
 * BRAND.primary }}>` so button styling stays consistent from a single source.
 *
 * Variants:
 *  - default      navy primary — the main call-to-action
 *  - destructive  red — delete / irreversible actions
 *  - secondary    accent-bordered light — the "…with details" style
 *  - outline      neutral-bordered — Cancel / dismiss
 *  - ghost        borderless — subtle inline actions
 *  - link         inline text link
 * Sizes: sm (toolbar), md (default / modal footer), xs (dense), icon.
 *
 * Every size carries `min-h-[24px]`, which is WCAG 2.5.8 Target Size (Minimum, AA) in CSS px, and it
 * is a px literal deliberately: `min-h-6` is a rem and `html { font-size: 14px }` would resolve it to
 * 21px, i.e. silently under the floor the class exists to hold. Measured before it was added, `sm`
 * computed to about 22px tall and `xs` to about 17.5px — both below the minimum, on the two sizes the
 * toolbars and dense grids use most.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40',
        destructive:
          'bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50',
        secondary:
          'border border-accent-border-strong bg-surface-hover text-primary hover:opacity-90 disabled:opacity-50',
        outline:
          'border border-border-subtle font-medium text-muted-foreground hover:bg-background disabled:opacity-50',
        ghost: 'font-medium text-muted-foreground hover:bg-surface-hover disabled:opacity-50',
        link: 'font-medium text-primary-light underline-offset-4 hover:underline',
      },
      size: {
        md: 'min-h-[24px] px-4 py-1.5 text-ui-sm',
        sm: 'min-h-[24px] px-3 py-1 text-ui-sm',
        xs: 'min-h-[24px] px-2 py-0.5 text-ui-xs',
        icon: 'min-h-[24px] min-w-[24px] p-1',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'md',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
