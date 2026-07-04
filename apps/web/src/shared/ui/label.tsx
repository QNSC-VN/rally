"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from "@/shared/lib/utils"

/**
 * Rally-tuned Label — compact 11px semibold matches all form panels and modals.
 * Backed by Radix Label for correct htmlFor/accessibility wiring.
 */
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "block text-[11px] font-semibold text-muted-foreground select-none",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
