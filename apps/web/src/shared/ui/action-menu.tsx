import { useState, type ReactNode } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { MoreVertical } from 'lucide-react'

import { AppPopoverContent } from '@/shared/ui/app-popover'
import { BRAND } from '@/shared/config/brand'
import { cn } from '@/shared/lib/utils'

/**
 * ActionMenu — the shared kebab menu for actions that do not deserve a toolbar button.
 *
 * Rally puts a plan's rarer verbs (Edit Plan Details, Delete, Move To Another Plan) behind one
 * `⋮` rather than lining them up beside Publish, because a destructive action sitting next to the
 * primary one gets clicked by accident. This is that control.
 *
 * Built on the same Radix Popover + `AppPopoverContent` wrapper every other popover in the app
 * uses, so it inherits the dialog scroll-lock fix and portals identically.
 */
export function ActionMenu({
  ariaLabel,
  children,
  onDark = false,
  icon,
  iconSize = 15,
}: {
  ariaLabel: string
  /** `ActionMenuItem`s. Rendered in a single column; the menu closes on any click inside. */
  children: ReactNode
  /** Trigger sits on the dark detail header, where a muted-grey glyph is invisible. */
  onDark?: boolean
  /**
   * Overrides the `⋮` glyph. Rally uses a GEAR where the menu holds display preferences
   * rather than verbs — a kebab promises "things this does", a gear promises "how this
   * looks", and they are not interchangeable to a reader.
   */
  icon?: ReactNode
  iconSize?: number
}) {
  const [open, setOpen] = useState(false)

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'rounded p-1.5 transition-colors',
            onDark
              ? 'text-white hover:bg-white/10'
              : 'text-muted-foreground hover:bg-surface-subtle',
          )}
        >
          {icon ?? <MoreVertical size={iconSize} />}
        </button>
      </PopoverPrimitive.Trigger>
      <AppPopoverContent
        align="end"
        sideOffset={4}
        className="z-50 min-w-44 rounded-sm border border-border-strong bg-card py-1 shadow-lg"
        // Any item click is a decision — the menu has done its job either way.
        onClick={() => setOpen(false)}
      >
        {children}
      </AppPopoverContent>
    </PopoverPrimitive.Root>
  )
}

/** One row in an {@link ActionMenu}. `destructive` colours it, it does not confirm — callers do. */
export function ActionMenuItem({
  icon,
  label,
  onClick,
  destructive = false,
  disabled = false,
}: {
  icon?: ReactNode
  label: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui-sm transition-colors hover:bg-surface-subtle disabled:opacity-50"
      style={{ color: destructive ? BRAND.danger : undefined }}
    >
      {icon}
      {label}
    </button>
  )
}
