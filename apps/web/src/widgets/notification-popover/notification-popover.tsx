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
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { Bell, CheckCheck, ExternalLink } from 'lucide-react'
import {
  useNotifications,
  useNotificationUnreadCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/features/notifications/api'
import { useOpenNotification } from '@/features/notifications/use-open-notification'
import { NotificationItem } from '@/features/notifications/ui/notification-item'
import { EmptyState } from '@/shared/ui/empty-state'

// ── Main component ────────────────────────────────────────────────────────────

interface NotificationPopoverProps {
  /** Controlled open state — parent holds it so the bell button can toggle it */
  open: boolean
  onClose: () => void
}

export function NotificationPopover({ open, onClose }: NotificationPopoverProps) {
  const { t } = useTranslation('notifications')
  const panelRef = useRef<HTMLDivElement>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)

  const { data: unreadCount = 0 } = useNotificationUnreadCount()
  const { data: notifications = [], isLoading } = useNotifications({ unreadOnly })
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const openNotification = useOpenNotification()

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
      className="absolute top-full right-0 z-50 mt-1.5 flex flex-col overflow-hidden rounded-lg border border-border-strong bg-card shadow-2xl"
      style={{
        width: 380,
        maxHeight: 520,
        // Subtle drop-shadow to lift above header
        boxShadow: '0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle bg-surface-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-ui-lg font-semibold text-foreground">
            {t('common:notifications')}
          </span>
          {unreadCount > 0 && (
            <span className="rounded-full bg-destructive px-1.5 py-0.5 text-ui-xs font-bold text-white">
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
              className="h-3 w-3 rounded accent-primary"
            />
            <span className="text-ui-xs text-muted-foreground">{t('unreadOnly')}</span>
          </label>

          {/* Mark all read */}
          {unreadCount > 0 && (
            <button
              onClick={() => void markAll.mutateAsync()}
              disabled={markAll.isPending}
              title="Mark all as read"
              className="flex items-center gap-1 rounded border border-border-strong px-2 py-1 text-ui-xs font-medium text-muted-foreground transition-colors hover:bg-card disabled:opacity-50"
            >
              <CheckCheck size={11} />
              {t('allRead')}
            </button>
          )}
        </div>
      </div>

      {/* ── Notification list ── */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : displayed.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Bell size={28} className="text-foreground-subtle" />}
            title={unreadOnly ? t('empty.noUnread') : t('empty.caughtUp')}
          />
        ) : (
          <ul>
            {displayed.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onMarkRead={(id) => void markRead.mutateAsync(id)}
                isMarkingRead={markRead.isPending}
                onActivate={() => {
                  openNotification(n)
                  onClose()
                }}
                showBadge
                dense
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="flex shrink-0 items-center justify-between border-t border-border-subtle bg-surface-subtle px-4 py-2.5">
        <span className="text-ui-xs text-foreground-subtle">
          {t('showingCount', { shown: displayed.length, total: notifications.length })}
        </span>
        <Link
          to={'/notifications' as '/'}
          onClick={onClose}
          className="flex items-center gap-1 text-ui-sm font-medium text-primary-light transition-colors hover:underline"
        >
          {t('viewAll')}
          <ExternalLink size={10} />
        </Link>
      </div>
    </div>
  )
}
