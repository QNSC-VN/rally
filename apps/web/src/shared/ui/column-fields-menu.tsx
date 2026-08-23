import { useCallback, useMemo, useState } from 'react'
import { Columns, Search } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import type { ColumnDef } from '@/shared/lib/hooks/use-column-layout'
import { BRAND } from '@/shared/config/brand'
import { AppPopoverContent } from '@/shared/ui/app-popover'
import { registerOpenPopover, unregisterOpenPopover } from '@/shared/ui/popover-coordinator'

interface ColumnFieldsMenuProps<K extends string> {
  columns: ColumnDef<K>[]
  order: K[]
  hidden: Set<K>
  onToggle: (key: K) => void
  /** Column reorder — accepted for API compatibility; the menu no longer
   *  exposes drag-reorder (real-Rally "Show Columns" is checkboxes only). */
  onReorder?: (dragKey: K, overKey: K) => void
  buttonStyle?: React.CSSProperties
}

const PANEL_BG = BRAND.surface
const PANEL_BORDER = BRAND.borderSubtle
const ACCENT = BRAND.primary

/**
 * "Show Fields" trigger button + dropdown panel (real-Rally "Show Columns"
 * parity): a search box filters by label, then columns split into SELECTED
 * (visible — checked) and AVAILABLE (hidden — unchecked), mirroring the shared
 * SearchableSelect multi-select grouping. Checkboxes only — no drag-reorder.
 * Shared across Iteration Status / Backlog / Team Status / Projects / etc.
 *
 * The panel is a Radix popover through the shared `AppPopoverContent`, not a hand-positioned
 * `absolute` div. It was the latter, pinned `right: 0` to the trigger, which is only correct while the
 * trigger sits at the RIGHT end of a toolbar. Capacity Planning's Features tab puts it at the left, so
 * a 260px panel anchored to a trigger 188px from the window edge rendered most of itself off-screen —
 * the field list was unreachable. Radix measures and flips/shifts against the viewport, so the panel is
 * correct at either end of any toolbar, and portalling it means no ancestor's `overflow` can clip it
 * (these grids scroll horizontally).
 */
export function ColumnFieldsMenu<K extends string>({
  columns,
  order,
  hidden,
  onToggle,
  buttonStyle,
}: ColumnFieldsMenuProps<K>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Coordinated like the other shared popovers: opening this closes an open cell editor, so a grid
  // never shows two panels at once.
  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  /**
   * Only columns that HAVE a label. Several grids carry unlabelled gutter columns — Capacity
   * Planning's `+/-` marker, a row-actions column, the Estimate glyph — and each was listed here as a
   * checkbox with no text beside it: a control whose effect a reader cannot know, and which the search
   * box can never match. They are chrome, not fields.
   */
  const nameable = useMemo(() => columns.filter((c) => c.label.trim() !== ''), [columns])
  // SELECTED = visible columns in their display order; AVAILABLE = hidden ones.
  const byKey = useMemo(() => new Map(nameable.map((c) => [c.key, c])), [nameable])
  const q = query.trim().toLowerCase()
  const matches = (c: ColumnDef<K>) => !q || c.label.toLowerCase().includes(q)

  const selected = order
    .map((k) => byKey.get(k))
    .filter((c): c is ColumnDef<K> => !!c && !hidden.has(c.key))
    .filter(matches)
  const available = nameable.filter((c) => hidden.has(c.key)).filter(matches)

  function renderRow(col: ColumnDef<K>) {
    return (
      <label
        key={col.key}
        className="flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-surface-subtle"
        style={{
          fontSize: 12.5,
          color: BRAND.textPrimary,
          cursor: col.locked ? 'default' : 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={!hidden.has(col.key)}
          disabled={col.locked}
          onChange={() => onToggle(col.key)}
          style={{ accentColor: ACCENT, cursor: col.locked ? 'default' : 'pointer' }}
        />
        {col.label}
      </label>
    )
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) registerOpenPopover(close)
        else {
          unregisterOpenPopover(close)
          setQuery('')
        }
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5"
          style={{
            fontSize: 12,
            color: open ? ACCENT : BRAND.textPrimary,
            background: open ? BRAND.primaryLighter : 'none',
            border: 'none',
            borderRadius: 2,
            padding: '4px 8px',
            cursor: 'pointer',
            ...buttonStyle,
          }}
        >
          <Columns size={14} /> Show Fields
        </button>
      </PopoverPrimitive.Trigger>
      <AppPopoverContent
        // `end`-aligned as before — Rally hangs the panel off the trigger's right edge — but Radix
        // shifts it back inside the viewport when there is no room, which is the whole fix.
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="flex flex-col"
        style={{
          width: 260,
          maxHeight: 300,
          background: PANEL_BG,
          border: `1px solid ${PANEL_BORDER}`,
          borderRadius: 4,
          boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
          // No stacking value here: `AppPopoverContent` sets the layer floor for every popover, and
          // this menu's copy of it went there. An inline one would also OUTRANK that class and
          // quietly become the only place the layer is stated for this menu.
          padding: 6,
        }}
      >
        {/* Search — same treatment as the shared SearchableSelect popover. */}
        <div className="mb-1 flex items-center gap-2 rounded-md border border-input px-2 py-1.5 transition-colors focus-within:border-primary">
          <Search size={13} className="shrink-0 text-primary" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fields…"
            aria-label="Search fields"
            className="w-full bg-transparent text-ui-sm text-foreground outline-none placeholder:text-foreground-subtle"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected.length > 0 && (
            <>
              <div className="px-1.5 pt-1.5 pb-1 text-ui-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Selected <span className="text-foreground-subtle">({selected.length})</span>
              </div>
              {selected.map(renderRow)}
            </>
          )}

          {available.length > 0 && (
            <>
              <div className="px-1.5 pt-2 pb-1 text-ui-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Available <span className="text-foreground-subtle">({available.length})</span>
              </div>
              {available.map(renderRow)}
            </>
          )}

          {selected.length === 0 && available.length === 0 && (
            <div className="px-1.5 py-3 text-center text-ui-sm text-foreground-subtle">
              No fields match “{query}”.
            </div>
          )}
        </div>
      </AppPopoverContent>
    </PopoverPrimitive.Root>
  )
}
