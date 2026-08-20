import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/shared/lib/utils'
import { TARGET_SQUARE } from '@/shared/ui/target-size'

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
 * Sizes: sm (dense grid rows), md (default toolbar), lg. All three are PADDING around the caller's
 * icon; the pointer target itself never falls below `TARGET_SQUARE` (WCAG 2.5.8 AA), which is why the
 * floor sits in the base class rather than in each size. Measured before it did, the three computed to
 * 15.5px, 19px and 22.5px tall around a 12px icon — the whole app's icon actions, all under the
 * minimum, because the padding is chosen for density and the icon size is the caller's.
 */
const iconButtonVariants = cva(
  `${TARGET_SQUARE} inline-flex shrink-0 items-center justify-center rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-30 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0`,
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
