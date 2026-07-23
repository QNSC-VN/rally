/**
 * AppPopoverContent — the single shared wrapper for every Radix Popover content
 * in the app (SearchableSelect, DateField, and any future popover-based control).
 *
 * Why this exists: when a popover is opened inside a Radix Dialog (our AppModal),
 * the dialog's body scroll-lock (`react-remove-scroll`) installs a document-level
 * wheel/touch listener that CANCELS scroll originating outside its subtree. A
 * Radix popover is portalled to <body> — outside that subtree — so its own
 * scrollable regions (e.g. a long option list) stop responding to the wheel even
 * though a scrollbar is shown.
 *
 * The fix is to stop the wheel/touch event from bubbling up to that document
 * listener, so the browser scrolls the popover's content natively. Centralising
 * it here means the guard is applied correct-by-construction to every popover —
 * no per-call-site or per-component rediscovery — and it is inert outside a
 * dialog (stopping propagation of a wheel over an open popover is always fine).
 */
import type { ComponentPropsWithoutRef } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'

type PopoverContentProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>

export interface AppPopoverContentProps extends PopoverContentProps {
  /** Optional portal container; defaults to document.body. */
  container?: HTMLElement | null
}

export function AppPopoverContent({
  container,
  onWheel,
  onTouchMove,
  children,
  ...contentProps
}: AppPopoverContentProps) {
  return (
    <PopoverPrimitive.Portal container={container ?? undefined}>
      <PopoverPrimitive.Content
        {...contentProps}
        onWheel={(e) => {
          // Keep the event from reaching the dialog scroll-lock's document
          // listener so the popover's own scroll regions work natively.
          e.stopPropagation()
          onWheel?.(e)
        }}
        onTouchMove={(e) => {
          e.stopPropagation()
          onTouchMove?.(e)
        }}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}
