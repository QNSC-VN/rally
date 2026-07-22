/**
 * DateField — the single, shared component for EVERY date attribute, in list
 * cells and detail panels alike (target date, start/release date, …). The date
 * equivalent of `StatusBadge` (status) / `StateStepper` (schedule state) /
 * `OwnerCell` (owner): one component per attribute type, so a date always looks
 * and behaves the same and no page hand-rolls `<input type="date">` again.
 *
 * Modes:
 *   - read-only → formatted text via `formatDate` (e.g. "Oct 7, 2025").
 *   - editable  → a compact trigger (formatted value + calendar glyph) that
 *                 opens a Radix Popover with the shared {@link Calendar}, plus a
 *                 "Clear" affordance. Emits an ISO date-only string (yyyy-MM-dd)
 *                 or null, matching the API's date fields.
 *
 * Value in: ISO date-only or timestamp string. Value out: yyyy-MM-dd | null.
 */
import { useCallback, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { format, parseISO } from 'date-fns'

import { Calendar } from '@/shared/ui/calendar'
import { BRAND } from '@/shared/config/brand'
import { cn } from '@/shared/lib/utils'
import { registerOpenPopover, unregisterOpenPopover } from '@/shared/ui/popover-coordinator'

/** Render an ISO date-only / timestamp string as `yyyy-MM-dd` (Rally's format). */
function toIsoLabel(value: string | null | undefined, placeholder: string): string {
  if (!value) return placeholder
  const d = value.length <= 10 ? parseISO(value) : new Date(value)
  return Number.isNaN(d.getTime()) ? placeholder : format(d, 'yyyy-MM-dd')
}

export interface DateFieldProps {
  value: string | null | undefined
  onChange?: (value: string | null) => void
  readOnly?: boolean
  /** Text shown when there is no value (default "—"). */
  placeholder?: string
  ariaLabel?: string
  /**
   * `cell` (default) — grid look: plain text at rest, calendar glyph + border
   * on hover. `field` — form look: a permanently bordered box + calendar glyph,
   * sized like other form inputs (detail panels, create/edit modals).
   */
  variant?: 'cell' | 'field'
  /** Extra classes for the trigger / read-only span. */
  className?: string
}

export function DateField({
  value,
  onChange,
  readOnly = false,
  placeholder = '—',
  ariaLabel = 'Date',
  variant = 'cell',
  className,
}: DateFieldProps) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const label = toIsoLabel(value, placeholder)

  if (readOnly || !onChange) {
    return (
      <span className={cn('font-mono text-ui-sm text-foreground', className)}>{label}</span>
    )
  }

  const hasValue = !!value

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) registerOpenPopover(close)
        else unregisterOpenPopover(close)
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'group w-full text-left text-foreground',
            variant === 'field'
              ? 'rounded border border-input bg-white px-3 py-2 text-ui-md transition-colors hover:border-ring focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
              : 'inline-edit-cell text-ui-sm',
            className,
          )}
        >
          <span className="flex w-full items-center justify-between gap-2">
            <span className={cn('truncate font-mono', !hasValue && 'text-foreground-subtle')}>
              {label}
            </span>
            {/* Calendar glyph: always in `field`; hover/open only in `cell` (plain text at rest). */}
            <CalendarDays
              size={variant === 'field' ? 14 : 13}
              className={cn(
                'shrink-0 text-muted-foreground',
                variant === 'cell' &&
                  'opacity-0 transition-opacity group-hover:opacity-100 group-data-[state=open]:opacity-100',
              )}
            />
          </span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 rounded-md border border-border bg-card shadow-lg"
          style={{ backgroundColor: BRAND.surface }}
        >
          <Calendar
            value={value}
            onSelect={(iso) => {
              onChange(iso)
              setOpen(false)
            }}
          />
          {hasValue && (
            <div className="flex justify-end border-t border-border-subtle px-2 py-1.5">
              <button
                type="button"
                onClick={() => {
                  onChange(null)
                  setOpen(false)
                }}
                className="rounded px-2 py-0.5 text-ui-sm font-medium text-muted-foreground hover:bg-surface-hover"
              >
                Clear
              </button>
            </div>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
