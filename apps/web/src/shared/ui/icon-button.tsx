import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/shared/lib/utils'

/**
 * IconButton — the single source of truth for icon-only actions.
 *
 * Codifies the icon-action pattern that was hand-written ~30+ times across the
 * app (`rounded p-1 disabled:opacity-30 style={{color:BRAND.textMuted}}` on a
 * raw `<button>` wrapping a lucide icon) — row edit/delete/reorder, modal close,
 * toolbar toggles, kebab triggers, etc.
 *
 * Every instance MUST pass `aria-label` (icon-only buttons have no text label);
 * this is enforced by the `aria-label` requirement in the props type.
 *
 * Variants: default (muted → hover surface), destructive (red on hover),
 *           active (navy, for a pressed/selected toggle).
 * Sizes: sm (dense grid rows), md (default toolbar), lg.
 */
const iconButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-30 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
        destructive: 'text-muted-foreground hover:bg-destructive-bg hover:text-destructive',
        active: 'bg-accent-blue text-primary hover:bg-accent-bg',
        ghost: 'text-muted-foreground hover:text-foreground',
      },
      size: {
        sm: 'p-0.5',
        md: 'p-1',
        lg: 'p-1.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
)

type IconButtonProps = Omit<React.ComponentProps<'button'>, 'aria-label'> &
  VariantProps<typeof iconButtonVariants> & {
    asChild?: boolean
    /** Required — icon-only buttons need an accessible name. */
    'aria-label': string
  }

function IconButton({ className, variant, size, asChild = false, ...props }: IconButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="icon-button"
      data-variant={variant ?? 'default'}
      className={cn(iconButtonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { IconButton, iconButtonVariants }
