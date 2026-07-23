import { cn } from '@/shared/lib/utils'
import { BRAND } from '@/shared/config/brand'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'

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
/** Initials chip shared by the read-only {@link OwnerCell} and the editable owner select. */
export function OwnerAvatar({
  name,
  avatarUrl,
  size = 20,
  className,
}: {
  name: string
  /** Optional profile image; falls back to initials when absent or it fails to load. */
  avatarUrl?: string | null
  /** Diameter in px (font scales with it). */
  size?: number
  className?: string
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        loading="lazy"
        className={cn('shrink-0 rounded-full object-cover', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('')

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        backgroundColor: BRAND.avatarBg,
        color: BRAND.avatarText,
      }}
    >
      {initials}
    </span>
  )
}

export function OwnerCell({ name, className }: OwnerCellProps) {
  if (!name) {
    return <span className="text-ui-xs text-foreground-disabled">—</span>
  }

  return (
    <div className={cn('flex items-center gap-1 overflow-hidden', className)}>
      <OwnerAvatar name={name} />
      <span className="truncate text-ui-xs text-muted-foreground">{name}</span>
    </div>
  )
}

/** Minimal member shape accepted by {@link OwnerSelectCell}. */
export interface OwnerSelectMember {
  userId: string
  displayName?: string | null
  email?: string | null
}

const memberName = (m: OwnerSelectMember) => m.displayName ?? m.email ?? m.userId

/**
 * Grouped options for a person picker (Rally parity): a "Quick Picks" group
 * with "— No Entry —" and the current owner, then an alphabetical "Team
 * Members" group — each with a round {@link OwnerAvatar} glyph. Shared by the
 * in-grid {@link OwnerSelectCell} and the form-field OwnerSelectField.
 */
export function ownerSelectOptions(
  members: OwnerSelectMember[],
  currentId?: string | null,
  currentName?: string | null,
): SelectOption[] {
  const withAvatar = (value: string, label: string, group: string): SelectOption => ({
    value,
    label,
    group,
    icon: <OwnerAvatar name={label} size={16} />,
  })

  const options: SelectOption[] = [{ value: '', label: '— No Entry —', group: 'Quick Picks' }]

  const current = currentId ? members.find((m) => m.userId === currentId) : undefined
  const currentLabel = current ? memberName(current) : (currentName ?? null)
  if (currentId && currentLabel) {
    options.push(withAvatar(currentId, currentLabel, 'Quick Picks'))
  }

  const sorted = [...members].sort((a, b) => memberName(a).localeCompare(memberName(b)))
  for (const m of sorted) options.push(withAvatar(m.userId, memberName(m), 'Team Members'))

  return options
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
 * grid. `owner`/`user`/`team` are the "search dropdown" attribute type: when
 * editable it renders the shared {@link SearchableSelect} (search a member,
 * plain-text options, hover-to-edit); when read-only it falls back to the
 * initials-chip {@link OwnerCell}. Replaces the hand-rolled `<select>` +
 * `editingOwner` toggles previously duplicated per page.
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
    <SearchableSelect
      value={assigneeId ?? ''}
      ariaLabel={ariaLabel}
      placeholder="Unassigned"
      searchPlaceholder="Search"
      options={ownerSelectOptions(members, assigneeId, ownerName)}
      onChange={(v) => onChange(v || null)}
    />
  )
}
