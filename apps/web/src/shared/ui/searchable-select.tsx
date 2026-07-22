/**
 * SearchableSelect — the single, shared dropdown for enum attributes (flow
 * state, schedule state, status, priority, severity …) AND entity references
 * (iteration, release, feature, milestone …), matching Broadcom Rally's field
 * dropdown exactly:
 *   - editable  → a bordered select box (value + chevron); on click a popover
 *                 opens with a bordered search box and a plain-text option list
 *                 (the selected row highlighted).
 *   - read-only → the value as plain text, no border / no affordance.
 *
 * Supports single-select (default) and `multiple` select (checkbox-style: rows
 * toggle without closing, the trigger shows `first (+N)`). Deliberately plain
 * (no colour badges) so every dropdown reads identically. Pairs with
 * {@link InlineEditableCell} (text/number) and {@link DateField} (dates).
 */
import { useCallback, useMemo, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { BRAND } from '@/shared/config/brand'
import { cn } from '@/shared/lib/utils'
import { registerOpenPopover, unregisterOpenPopover } from '@/shared/ui/popover-coordinator'

export interface SelectOption {
  value: string
  /** Display text for the trigger + option row. */
  label: string
  /** Extra text to match against when filtering (defaults to `label`). */
  searchText?: string
  /** Optional leading glyph (avatar / team chip / type badge) shown before the
   *  label in the trigger and each option row. Keep it small (~16px). */
  icon?: React.ReactNode
  /** Optional group header this option sits under (e.g. "Quick Picks",
   *  "Team Members"). Options are grouped in declared order; omit for no header. */
  group?: string
}

interface BaseProps {
  options: SelectOption[]
  readOnly?: boolean
  ariaLabel?: string
  placeholder?: string
  /** Placeholder shown in the search box. */
  searchPlaceholder?: string
  /**
   * `cell` (default) — grid-cell look: plain text at rest, border + chevron on
   * hover (the shared inline-edit affordance).
   * `field` — form look: a permanently bordered box + chevron, sized like other
   * form inputs (detail panels, create/edit modals).
   */
  variant?: 'cell' | 'field'
  /**
   * Optional custom content for the trigger, rendered in place of the default
   * icon + label (the chevron and popover behaviour are preserved). Use for
   * fields that need a special at-rest display — e.g. Schedule State's
   * segmented stepper — while still opening the shared searchable list.
   */
  triggerContent?: React.ReactNode
  className?: string
}

interface SingleProps extends BaseProps {
  multiple?: false
  value: string
  onChange: (value: string) => void
}

interface MultiProps extends BaseProps {
  /** Multi-select: rows toggle without closing; `value`/`onChange` use arrays. */
  multiple: true
  value: readonly string[]
  onChange: (value: string[]) => void
}

export type SearchableSelectProps = SingleProps | MultiProps

export function SearchableSelect(props: SearchableSelectProps) {
  const {
    options,
    readOnly = false,
    ariaLabel = 'Select',
    placeholder = '—',
    searchPlaceholder = 'Search',
    variant = 'cell',
    triggerContent,
    className,
  } = props
  const multiple = props.multiple === true

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const close = useCallback(() => setOpen(false), [])

  // Normalise the current selection to an id list regardless of mode.
  const selectedValues = useMemo(
    () => (multiple ? [...props.value] : props.value ? [props.value] : []),
    [multiple, props.value],
  )
  const isSelected = useCallback(
    (v: string) => (multiple ? props.value.includes(v) : props.value === v),
    [multiple, props.value],
  )

  // Trigger display: single → the selected label; multi → `first (+N)`.
  const selectedOpts = useMemo(
    () => options.filter((o) => selectedValues.includes(o.value)),
    [options, selectedValues],
  )
  const first = multiple ? selectedOpts[0] : options.find((o) => o.value === props.value)
  const extraCount = multiple ? Math.max(0, selectedOpts.length - 1) : 0
  const display = first?.label ?? placeholder
  const hasSelection = selectedValues.length > 0

  // Multi-select `field` shows EVERY selected value as a wrapping chip (Rally
  // parity) instead of the compact `first (+N)`. Cell variant stays compact so
  // grid rows don't grow.
  const showChips = multiple && variant === 'field' && hasSelection
  const chips = (
    <span className="flex flex-1 flex-wrap items-center gap-1">
      {selectedOpts.map((o) => (
        <span
          key={o.value}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-input bg-surface-subtle px-2 py-0.5 text-ui-xs text-foreground"
        >
          {o.icon}
          <span className="truncate">{o.label}</span>
        </span>
      ))}
    </span>
  )

  const handlePick = useCallback(
    (v: string) => {
      if (multiple) {
        const set = new Set(props.value)
        if (set.has(v)) set.delete(v)
        else set.add(v)
        props.onChange([...set])
        // keep the popover open so several toggles commit in one session
      } else {
        props.onChange(v)
        setOpen(false)
        setQuery('')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [multiple, props.value, props.onChange],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? options.filter((o) => (o.searchText ?? o.label).toLowerCase().includes(q))
      : options
  }, [options, query])

  // Grouping. Multi-select with NO explicit per-option groups → auto-split into
  // "Selected" / "Available" (Broadcom-Rally parity): checked items float to a
  // Selected bucket on top, the rest under Available; rows move live as you
  // toggle. Otherwise group in declared order (options without `group` fall in
  // one leading bucket).
  const grouped = useMemo(() => {
    if (multiple && !filtered.some((o) => o.group)) {
      const sel: SelectOption[] = []
      const avail: SelectOption[] = []
      for (const o of filtered) (selectedValues.includes(o.value) ? sel : avail).push(o)
      const auto: { name?: string; items: SelectOption[] }[] = []
      if (sel.length) auto.push({ name: 'Selected', items: sel })
      if (avail.length) auto.push({ name: 'Available', items: avail })
      return auto
    }
    const buckets: { name?: string; items: SelectOption[] }[] = []
    for (const o of filtered) {
      let b = buckets.find((x) => x.name === o.group)
      if (!b) {
        b = { name: o.group, items: [] }
        buckets.push(b)
      }
      b.items.push(o)
    }
    return buckets
  }, [filtered, multiple, selectedValues])

  if (readOnly) {
    if (showChips) {
      return <span className={cn('flex flex-wrap items-center gap-1', className)}>{chips}</span>
    }
    return (
      <span className={cn('flex items-center gap-1.5 text-ui-sm text-foreground', className)}>
        {first?.icon}
        <span className={cn('truncate', !hasSelection && 'text-foreground-subtle')}>{display}</span>
        {extraCount > 0 && (
          <span className="shrink-0 text-ui-xs text-foreground-subtle">+{extraCount}</span>
        )}
      </span>
    )
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) registerOpenPopover(close)
        else {
          unregisterOpenPopover(close)
          setQuery('')
        }
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
          <span className="flex w-full items-center justify-between gap-1">
            {triggerContent ? (
              <span className="flex min-w-0 flex-1 items-center">{triggerContent}</span>
            ) : showChips ? (
              chips
            ) : (
              <span className="flex min-w-0 items-center gap-1.5">
                {first?.icon}
                <span className={cn('truncate', !hasSelection && 'text-foreground-subtle')}>
                  {display}
                </span>
                {extraCount > 0 && (
                  <span className="shrink-0 text-ui-xs text-foreground-subtle">+{extraCount}</span>
                )}
              </span>
            )}
            {/* Chevron: always shown in `field`; hover/open only in `cell` (plain text at rest). */}
            <ChevronDown
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
          sideOffset={3}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-48 overflow-hidden rounded-md p-1 shadow-lg ring-1 ring-black/5"
          style={{ backgroundColor: BRAND.surface }}
        >
          {/* Search box — one full border, blue while focused (Rally parity). */}
          <div className="flex items-center gap-2 rounded-md border border-input px-2 py-1.5 transition-colors focus-within:border-primary">
            <Search size={13} className="shrink-0 text-primary" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              // Inline `outline: none` overrides the global `:focus-visible`
              // outline (globals.css) that would otherwise draw a 2px offset
              // ring inside the search box's own border → a doubled border.
              style={{ outline: 'none' }}
              className="w-full bg-transparent text-ui-sm text-foreground placeholder-foreground-subtle"
            />
          </div>

          {/* Options */}
          <div className="mt-1 max-h-60 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-ui-sm text-foreground-subtle">No matches</div>
            )}
            {grouped.map((bucket) => (
              <div key={bucket.name ?? '__ungrouped'}>
                {bucket.name && (
                  <div className="px-3 pt-2 pb-1 text-ui-2xs font-semibold tracking-wider text-foreground-subtle uppercase">
                    {bucket.name}
                  </div>
                )}
                {bucket.items.map((o) => {
                  const sel = isSelected(o.value)
                  return (
                    <button
                      key={`${bucket.name ?? ''}:${o.value}`}
                      type="button"
                      onClick={() => handlePick(o.value)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-ui-sm text-foreground transition-colors hover:bg-surface-hover',
                        // Single-select highlights the chosen row; multi-select shows
                        // its state via the leading checkbox, so no row highlight.
                        !multiple && sel && 'bg-primary-lighter',
                      )}
                    >
                      {/* Multi-select: leading checkbox (presentational — the row
                          button owns the toggle, so no nested interactive input). */}
                      {multiple && (
                        <span
                          className={cn(
                            'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border',
                            sel
                              ? 'border-primary bg-primary text-white'
                              : 'border-input bg-white',
                          )}
                        >
                          {sel && <Check size={11} strokeWidth={3} />}
                        </span>
                      )}
                      {o.icon}
                      <span className="truncate">{o.label}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
