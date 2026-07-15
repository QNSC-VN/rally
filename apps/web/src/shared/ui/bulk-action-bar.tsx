/**
 * BulkActionBar — the strip that appears above a table when ≥1 row is selected.
 *
 * A generic shell: it owns the consistent "N selected" label, the optional
 * inline error, and the clear-selection button. Each page passes its own
 * actions (assign, set-state, delete, …) as `children`, so the bar stays DRY
 * while remaining flexible per surface.
 *
 * Usage:
 *   {selection.count > 0 && (
 *     <BulkActionBar selectedCount={selection.count} onClear={selection.clear} error={err}>
 *       <InlineSelect …>…</InlineSelect>
 *       <button …>Delete</button>
 *     </BulkActionBar>
 *   )}
 */
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

interface BulkActionBarProps {
  selectedCount: number
  onClear: () => void
  /** Inline error surfaced by a failed bulk action. */
  error?: string | null
  /** Page-specific action controls. */
  children?: ReactNode
}

export function BulkActionBar({ selectedCount, onClear, error, children }: BulkActionBarProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 px-4 py-1.5"
      style={{ backgroundColor: '#edf2fb', borderBottom: '1px solid #bdd0ef' }}
    >
      <span className="mr-1 text-[11px] font-semibold" style={{ color: '#2558a6' }}>
        {selectedCount} selected
      </span>

      {children}

      {error && (
        <span className="text-[11px]" style={{ color: '#b91c1c' }}>
          {error}
        </span>
      )}

      <div className="flex-1" />
      <button
        onClick={onClear}
        className="p-0.5"
        style={{ color: '#5c6478' }}
        aria-label="Clear selection"
      >
        <X size={13} />
      </button>
    </div>
  )
}
