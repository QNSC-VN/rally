/**
 * Tooltip — lightweight Radix Tooltip wrapper.
 * Usage: <Tooltip content="Save"><button>…</button></Tooltip>
 */
import { Tooltip as TooltipPrimitive } from 'radix-ui'

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  delayDuration?: number
}

export function Tooltip({ content, children, side = 'top', delayDuration = 600 }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={5}
            className="z-50 max-w-xs rounded px-2 py-1 text-[11px] leading-tight text-white animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
            style={{ backgroundColor: '#1e2740', boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}
          >
            {content}
            <TooltipPrimitive.Arrow style={{ fill: '#1e2740' }} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
