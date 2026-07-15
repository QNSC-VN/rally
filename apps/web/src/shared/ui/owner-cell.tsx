import { cn } from '@/shared/lib/utils'
import { BRAND } from '@/shared/config/brand'
import { InlineCellSelect } from '@/shared/ui/native-select'

interface OwnerCellProps {
  name?: string | null
  /** Extra classes merged onto the wrapper. */
  className?: string
}

/**
 * Owner cell: a small initials chip + truncated name, with an em-dash
 * fallback when unassigned. Previously hand-rolled identically in backlog,
 * releases-detail and milestones-detail — consolidated here.
 *
 * (Distinct from the larger dark `Avatar` used in headers/menus.)
 */
export function OwnerCell({ name, className }: OwnerCellProps) {
  if (!name) {
    return (
      <span className="text-[10px]" style={{ color: BRAND.textDisabled }}>
        —
      </span>
    )
  }

  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('')

  return (
    <div className={cn('flex items-center gap-1 overflow-hidden', className)}>
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
        style={{ backgroundColor: BRAND.avatarBg, color: BRAND.avatarText }}
      >
        {initials}
      </span>
      <span className="truncate text-[10px]" style={{ color: BRAND.textSecondary }}>
        {name}
      </span>
    </div>
  )
}

/** Minimal member shape accepted by {@link OwnerSelectCell}. */
export interface OwnerSelectMember {
  userId: string
  displayName?: string | null
  email?: string | null
}

interface OwnerSelectCellProps {
  /** Resolved display name for the current assignee (null → unassigned). */
  ownerName?: string | null
  /** Current assignee user id (null → unassigned). */
  assigneeId?: string | null
  members: OwnerSelectMember[]
  canEdit: boolean
  onChange: (userId: string | null) => void
  ariaLabel?: string
}

/**
 * Owner column — single source of truth for the whole Owner cell across every
 * work-item grid. When editable it renders the shared {@link InlineCellSelect}
 * (overlay select + truncation + "Unassigned" muted state); when read-only it
 * falls back to the initials-chip {@link OwnerCell}. Replaces the hand-rolled
 * `<select>` + `editingOwner` toggles previously duplicated per page.
 */
export function OwnerSelectCell({
  ownerName,
  assigneeId,
  members,
  canEdit,
  onChange,
  ariaLabel = 'Owner',
}: OwnerSelectCellProps) {
  if (!canEdit) return <OwnerCell name={ownerName} />
  return (
    <InlineCellSelect
      value={assigneeId ?? ''}
      displayValue={ownerName ?? 'Unassigned'}
      muted={!assigneeId}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={ariaLabel}
    >
      <option value="">Unassigned</option>
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.displayName ?? m.email ?? m.userId}
        </option>
      ))}
    </InlineCellSelect>
  )
}
