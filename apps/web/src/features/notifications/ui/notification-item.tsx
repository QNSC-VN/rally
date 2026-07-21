/**
 * NotificationItem — the single source of truth for a notification row.
 *
 * The bell popover, the full Notification Center page, and the Home
 * "Recent Activity" feed all render the same shape: a read/unread dot, an
 * optional resource pill, a title (bold while unread), an optional body, and a
 * relative timestamp. This component owns that markup so the three surfaces stay
 * pixel-consistent; callers vary only behaviour via props.
 *
 * - `onMarkRead`  → the dot becomes an inline "mark as read" button.
 * - `onActivate`  → the whole row is clickable (navigate / close popover).
 * - `showBadge`   → render the resourceType pill above the title.
 * - `dense`       → compact spacing + type scale for popovers / side panels.
 */
import { Circle, CircleDot } from 'lucide-react'
import { cn, relativeTime } from '@/shared/lib/utils'
import type { Notification } from '@/features/notifications/api'

interface NotificationItemProps {
  notification: Notification
  /** When provided, the read/unread dot becomes a button that marks the item read. */
  onMarkRead?: (id: string) => void
  isMarkingRead?: boolean
  /** Click handler for the row (navigate / close popover). */
  onActivate?: () => void
  /** Render the resourceType pill above the title. */
  showBadge?: boolean
  /** Compact spacing + type scale (popover / side panels). Defaults to page density. */
  dense?: boolean
}

export function NotificationItem({
  notification: n,
  onMarkRead,
  isMarkingRead = false,
  onActivate,
  showBadge = false,
  dense = false,
}: NotificationItemProps) {
  const dotSize = dense ? 7 : 8

  const dot = n.isRead ? (
    <Circle size={dotSize} className="text-border-strong" />
  ) : (
    <CircleDot size={dotSize} className="text-primary" />
  )

  return (
    <li
      className={cn(
        'flex items-start gap-3 border-b border-border-inner transition-colors hover:bg-surface-hover',
        dense ? 'px-4 py-3' : 'px-6 py-4',
        onActivate && 'cursor-pointer',
        !n.isRead && 'bg-accent-bg-subtle',
      )}
      onClick={onActivate}
      role={onActivate ? 'presentation' : undefined}
    >
      {/* Read / unread indicator */}
      {onMarkRead ? (
        <button
          title={n.isRead ? 'Read' : 'Mark as read'}
          aria-label={n.isRead ? 'Read' : 'Mark as read'}
          disabled={n.isRead || isMarkingRead}
          onClick={(e) => {
            e.stopPropagation()
            onMarkRead(n.id)
          }}
          className={`shrink-0 transition-opacity hover:opacity-70 disabled:cursor-default ${
            dense ? 'mt-1' : 'mt-0.5'
          }`}
        >
          {dot}
        </button>
      ) : (
        <span className={`shrink-0 ${dense ? 'mt-1' : 'mt-0.5'}`} aria-hidden>
          {dot}
        </span>
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        {showBadge && n.resourceType && (
          <span className="mb-0.5 inline-block rounded-sm bg-avatar px-1.5 py-0.5 text-ui-2xs font-semibold tracking-wide text-primary uppercase">
            {n.resourceType}
          </span>
        )}
        <p
          className={cn(
            'text-foreground',
            dense ? 'text-ui-md leading-[1.4]' : 'text-ui-lg leading-5',
          )}
          style={{ fontWeight: n.isRead ? 400 : 600 }}
        >
          {n.title}
        </p>
        {n.body && (
          <p
            className={cn(
              'mt-0.5 line-clamp-2 text-muted-foreground',
              dense ? 'text-ui-sm leading-[1.4]' : 'text-ui-md leading-4',
            )}
          >
            {n.body}
          </p>
        )}
        <p className={cn('mt-1 text-foreground-subtle', dense ? 'text-ui-xs' : 'text-ui-sm')}>
          {relativeTime(n.createdAt)}
        </p>
      </div>
    </li>
  )
}
