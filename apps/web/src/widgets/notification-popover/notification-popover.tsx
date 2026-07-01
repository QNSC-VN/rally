/**
 * NotificationPopover — enterprise-grade bell dropdown.
 *
 * Pattern: GitHub / Linear / Jira
 *  - Click bell → popover with last 20 notifications
 *  - Unread items highlighted; click blue dot to mark read inline
 *  - "Mark all read" button in header
 *  - "View all →" footer link to /notifications full page
 *  - Close on outside-click or Escape
 *  - Accessible: aria-haspopup, focus trap exit via Escape
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Bell, CheckCheck, Circle, CircleDot, ExternalLink } from 'lucide-react'
import { BRAND } from '@/shared/config/brand'
import {
  useNotifications,
  useNotificationUnreadCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/features/notifications/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NotificationRow({
  notification,
  onRead,
  isPending,
  onClose,
}: {
  notification: {
    id: string
    title: string
    body: string | null
    isRead: boolean
    resourceType: string | null
    createdAt: string
  }
  onRead: (id: string) => void
  isPending: boolean
  onClose: () => void
}) {
  return (
    <li
      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[#f7f8fa]"
      style={{
        borderBottom: `1px solid ${BRAND.borderInner}`,
        backgroundColor: notification.isRead ? undefined : BRAND.primaryLighter,
      }}
    >
      {/* Read / unread dot */}
      <button
        title={notification.isRead ? 'Already read' : 'Mark as read'}
        disabled={notification.isRead || isPending}
        onClick={() => onRead(notification.id)}
        className="mt-1 shrink-0 transition-opacity hover:opacity-70 disabled:cursor-default"
        aria-label={notification.isRead ? 'Read' : 'Mark as read'}
      >
        {notification.isRead ? (
          <Circle size={7} style={{ color: BRAND.border }} />
        ) : (
          <CircleDot size={7} style={{ color: BRAND.primary }} />
        )}
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1" onClick={onClose} role="presentation">
        {notification.resourceType && (
          <span
            className="mb-0.5 inline-block rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: '#e5ebf4', color: BRAND.primary }}
          >
            {notification.resourceType}
          </span>
        )}
        <p
          className="text-[12px] leading-[1.4]"
          style={{
            color: BRAND.textPrimary,
            fontWeight: notification.isRead ? 400 : 600,
          }}
        >
          {notification.title}
        </p>
        {notification.body && (
          <p
            className="mt-0.5 line-clamp-2 text-[11px] leading-[1.4]"
            style={{ color: BRAND.textSecondary }}
          >
            {notification.body}
          </p>
        )}
        <p className="mt-1 text-[10px]" style={{ color: BRAND.textMuted }}>
          {relativeTime(notification.createdAt)}
        </p>
      </div>
    </li>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface NotificationPopoverProps {
  /** Controlled open state — parent holds it so the bell button can toggle it */
  open: boolean
  onClose: () => void
}

export function NotificationPopover({ open, onClose }: NotificationPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)

  const { data: unreadCount = 0 } = useNotificationUnreadCount()
  const { data: notifications = [], isLoading } = useNotifications(unreadOnly)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Use capture phase so clicks on portals (toasts etc.) don't bleed
    document.addEventListener('mousedown', handleClick, true)
    return () => document.removeEventListener('mousedown', handleClick, true)
  }, [open, onClose])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const displayed = notifications.slice(0, 20)

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      className="absolute top-full right-0 z-50 mt-1.5 flex flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
      style={{
        width: 380,
        maxHeight: 520,
        border: `1px solid ${BRAND.border}`,
        // Subtle drop-shadow to lift above header
        boxShadow: '0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      {/* ── Header ── */}
      <div
        className="flex shrink-0 items-center justify-between px-4 py-3"
        style={{ borderBottom: `1px solid ${BRAND.borderSubtle}`, backgroundColor: BRAND.surfaceSubtle }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold" style={{ color: BRAND.textPrimary }}>
            Notifications
          </span>
          {unreadCount > 0 && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ backgroundColor: '#e5484d' }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Unread toggle */}
          <label className="flex cursor-pointer items-center gap-1 select-none">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="h-3 w-3 rounded accent-[#1d3f73]"
            />
            <span className="text-[10px]" style={{ color: BRAND.textSecondary }}>
              Unread only
            </span>
          </label>

          {/* Mark all read */}
          {unreadCount > 0 && (
            <button
              onClick={() => void markAll.mutateAsync()}
              disabled={markAll.isPending}
              title="Mark all as read"
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors hover:bg-white disabled:opacity-50"
              style={{ color: BRAND.textSecondary, border: `1px solid ${BRAND.border}` }}
            >
              <CheckCheck size={11} />
              All read
            </button>
          )}
        </div>
      </div>

      {/* ── Notification list ── */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <div
              className="h-4 w-4 animate-spin rounded-full border-2"
              style={{ borderColor: BRAND.primary, borderTopColor: 'transparent' }}
            />
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: '#e5ebf4' }}
            >
              <Bell size={20} style={{ color: BRAND.primary }} />
            </div>
            <p className="text-center text-[12px]" style={{ color: BRAND.textSecondary }}>
              {unreadOnly ? 'No unread notifications' : "You're all caught up"}
            </p>
          </div>
        ) : (
          <ul>
            {displayed.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                onRead={(id) => void markRead.mutateAsync(id)}
                isPending={markRead.isPending}
                onClose={onClose}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── Footer ── */}
      <div
        className="flex shrink-0 items-center justify-between px-4 py-2.5"
        style={{ borderTop: `1px solid ${BRAND.borderSubtle}`, backgroundColor: BRAND.surfaceSubtle }}
      >
        <span className="text-[10px]" style={{ color: BRAND.textMuted }}>
          Showing {displayed.length} of {notifications.length}
        </span>
        <Link
          to={'/notifications' as '/'}
          onClick={onClose}
          className="flex items-center gap-1 text-[11px] font-medium transition-colors hover:underline"
          style={{ color: BRAND.primaryLight }}
        >
          View all
          <ExternalLink size={10} />
        </Link>
      </div>
    </div>
  )
}
