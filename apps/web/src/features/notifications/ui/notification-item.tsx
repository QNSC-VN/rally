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
import { BRAND } from '@/shared/config/brand'
import { relativeTime } from '@/shared/lib/utils'
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
    <Circle size={dotSize} style={{ color: BRAND.border }} />
  ) : (
    <CircleDot size={dotSize} style={{ color: BRAND.primary }} />
  )

  return (
    <li
      className={`flex items-start gap-3 transition-colors hover:bg-surface-hover ${
        dense ? 'px-4 py-3' : 'px-6 py-4'
      } ${onActivate ? 'cursor-pointer' : ''}`}
      style={{
        borderBottom: `1px solid ${BRAND.borderInner}`,
        backgroundColor: n.isRead ? undefined : BRAND.accentBgSubtle,
      }}
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
          <span
            className="mb-0.5 inline-block rounded-sm px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase"
            style={{ backgroundColor: BRAND.avatarBg, color: BRAND.primary }}
          >
            {n.resourceType}
          </span>
        )}
        <p
          className={dense ? 'text-[12px] leading-[1.4]' : 'text-[13px] leading-5'}
          style={{ color: BRAND.textPrimary, fontWeight: n.isRead ? 400 : 600 }}
        >
          {n.title}
        </p>
        {n.body && (
          <p
            className={`mt-0.5 line-clamp-2 ${dense ? 'text-[11px] leading-[1.4]' : 'text-[12px] leading-4'}`}
            style={{ color: BRAND.textSecondary }}
          >
            {n.body}
          </p>
        )}
        <p
          className={`mt-1 ${dense ? 'text-[10px]' : 'text-[11px]'}`}
          style={{ color: BRAND.textMuted }}
        >
          {relativeTime(n.createdAt)}
        </p>
      </div>
    </li>
  )
}
