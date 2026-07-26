import { useMemo, useState } from 'react'
import { Columns, Search } from 'lucide-react'
import type { ColumnDef } from '@/shared/lib/hooks/use-column-layout'
import { useClickOutside } from '@/shared/lib/hooks/use-click-outside'
import { BRAND } from '@/shared/config/brand'

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
  const rootRef = useClickOutside<HTMLDivElement>(open, () => {
    setOpen(false)
    setQuery('')
  })

  // SELECTED = visible columns in their display order; AVAILABLE = hidden ones.
  const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns])
  const q = query.trim().toLowerCase()
  const matches = (c: ColumnDef<K>) => !q || c.label.toLowerCase().includes(q)

  const selected = order
    .map((k) => byKey.get(k))
    .filter((c): c is ColumnDef<K> => !!c && !hidden.has(c.key))
    .filter(matches)
  const available = columns.filter((c) => hidden.has(c.key)).filter(matches)

  function renderRow(col: ColumnDef<K>) {
    return (
      <label
        key={col.key}
        className="flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-surface-subtle"
        style={{ fontSize: 12.5, color: BRAND.textPrimary, cursor: col.locked ? 'default' : 'pointer' }}
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
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
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
      {open && (
        <div
          className="flex flex-col"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            width: 260,
            maxHeight: 300,
            background: PANEL_BG,
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 4,
            boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
            zIndex: 50,
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
                <div className="px-1.5 pt-1.5 pb-1 text-ui-2xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Selected <span className="text-foreground-subtle">({selected.length})</span>
                </div>
                {selected.map(renderRow)}
              </>
            )}

            {available.length > 0 && (
              <>
                <div className="px-1.5 pt-2 pb-1 text-ui-2xs font-semibold tracking-wide text-muted-foreground uppercase">
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
        </div>
      )}
    </div>
  )
}
