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
 * Read-only team cell: a {@link TeamAvatar} key-chip + team name, with a `--` fallback when unassigned.
 * Mirrors {@link OwnerCell}.
 *
 * `text-ui-sm` — the app's "most grid cells" size — and the name's line box is at least as tall as the
 * chip, so a single-line name sits CENTRED against it. It was `text-ui-xs` (10px, the dense-cell size)
 * with the text top-aligned, which showed up the moment Capacity Planning rendered this same component
 * two ways in one row: as a plain cell and as a select's trigger content. The trigger's own 11px text
 * made the read-only cell look shrunken beside it, and the top alignment made it sit high in the row.
 * Both are fixed here rather than per-call-site, or the two renderings drift again.
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
    return <span className="text-ui-sm text-foreground-disabled">--</span>
  }

  return (
    <div className={cn('flex items-start gap-1', className)}>
      <TeamAvatar teamKey={teamKey} name={name} />
      {/* `min-h-5` is the chip's own 20px: a one-line name centres against it, a wrapped one still
          starts level with its top. */}
      <span className="flex min-h-5 min-w-0 items-center text-ui-sm break-words whitespace-normal text-muted-foreground">
        {name ?? teamKey}
      </span>
    </div>
  )
}
