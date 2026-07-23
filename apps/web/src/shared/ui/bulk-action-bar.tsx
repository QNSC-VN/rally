/**
 * BulkActionBar — the strip that appears above a table when ≥1 row is selected.
 *
 * Rally-parity chrome: a left cluster with "N Item(s) Selected" and a
 * "Deselect All" link, then the page's action controls. Each page passes its
 * own actions (edit, delete, copy, assign, set-state, …) as `children`, so the
 * bar stays DRY while remaining flexible per surface.
 *
 * Usage:
 *   {selection.count > 0 && (
 *     <BulkActionBar selectedCount={selection.count} onClear={selection.clear} error={err}>
 *       <BulkBarButton icon={<Trash2/>} label="Delete" onClick={…} />
 *       <BulkBarButton icon={<Copy/>} label="Copy" disabled={selection.count > 1} onClick={…} />
 *     </BulkActionBar>
 *   )}
 */
import { BRAND } from '@/shared/config/brand'
import type { ReactNode } from 'react'

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
      className="flex shrink-0 items-center gap-4 px-4 py-1.5"
      style={{
        backgroundColor: BRAND.primaryLighter,
        borderBottom: `1px solid ${BRAND.accentBorder}`,
      }}
    >
      {/* Rally-style count + Deselect All */}
      <div className="flex flex-col leading-tight">
        <span className="text-ui-sm font-semibold text-primary-light">
          {selectedCount} {selectedCount === 1 ? 'Item' : 'Items'} Selected
        </span>
        <button
          onClick={onClear}
          className="text-left text-ui-xs text-primary-light hover:underline"
          aria-label="Deselect all"
        >
          Deselect All
        </button>
      </div>

      {children}

      {error && <span className="text-ui-sm text-destructive">{error}</span>}

      <div className="flex-1" />
    </div>
  )
}

/**
 * A single Rally-style bulk action (icon + label). Renders disabled/greyed when
 * `disabled` (e.g. Copy is disabled once more than one row is selected).
 */
export function BulkBarButton({
  icon,
  label,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon?: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 rounded px-2 py-1 text-ui-sm font-medium transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? 'text-destructive' : 'text-primary-light'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
