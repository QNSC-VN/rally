import { cn } from '@/shared/lib/utils'
import { BRAND } from '@/shared/config/brand'

/**
 * Team identity chip — the team counterpart to {@link OwnerAvatar}.
 *
 * Teams render as a rounded **square** key-chip (vs. the round user avatar),
 * giving a consistent visual language: circle = person, square = team. Single
 * source of truth for the team glyph across every grid with a team column
 * (settings teams list, projects "Teams" column, …).
 */
export function TeamAvatar({
  teamKey,
  name,
  size = 20,
  className,
}: {
  /** Team key (e.g. "ALPHA"); first two chars form the chip label. */
  teamKey?: string | null
  /** Falls back to the name's initials when no key is available. */
  name?: string | null
  /** Side length in px (font scales with it). */
  size?: number
  className?: string
}) {
  const source = (teamKey ?? name ?? '').trim()
  const label = teamKey
    ? teamKey.slice(0, 2).toUpperCase()
    : source
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0]?.toUpperCase())
        .join('')

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-bold text-white',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        backgroundColor: BRAND.primary,
      }}
    >
      {label}
    </span>
  )
}

/**
 * Read-only team cell: a {@link TeamAvatar} key-chip + truncated team name,
 * with an em-dash fallback when unassigned. Mirrors {@link OwnerCell}.
 */
export function TeamCell({
  teamKey,
  name,
  className,
}: {
  teamKey?: string | null
  name?: string | null
  className?: string
}) {
  if (!name && !teamKey) {
    return (
      <span className="text-[10px]" style={{ color: BRAND.textDisabled }}>
        —
      </span>
    )
  }

  return (
    <div className={cn('flex items-center gap-1 overflow-hidden', className)}>
      <TeamAvatar teamKey={teamKey} name={name} />
      <span className="truncate text-[10px]" style={{ color: BRAND.textSecondary }}>
        {name ?? teamKey}
      </span>
    </div>
  )
}
