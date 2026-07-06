import { useState } from 'react'
import { AlertTriangle, Bell, CheckCheck, Circle, CircleDot } from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/features/notifications/api'

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false)
  const { data: notifications = [], isLoading, isError } = useNotifications(unreadOnly)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()

  const unreadCount = notifications.filter((n) => !n.isRead).length

  async function handleMarkAll() {
    try {
      await markAll.mutateAsync()
      toast.success('All notifications marked as read')
    } catch {
      toast.error('Failed to mark all as read')
    }
  }

  return (
    <div className="flex flex-1 flex-col" style={{ backgroundColor: BRAND.pageBg, minHeight: 0 }}>
      {/* ── Header ── */}
      <div
        className="flex shrink-0 items-center justify-between px-6 py-4"
        style={{ borderBottom: `1px solid ${BRAND.border}`, backgroundColor: BRAND.surface }}
      >
        <div className="flex items-center gap-3">
          <Bell size={16} style={{ color: BRAND.textSecondary }} />
          <h1 className="text-[15px] font-semibold" style={{ color: BRAND.textPrimary }}>
            Notifications
          </h1>
          {unreadCount > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
              style={{ backgroundColor: BRAND.primary }}
            >
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 select-none">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="rounded"
            />
            <span className="text-[12px]" style={{ color: BRAND.textSecondary }}>
              Unread only
            </span>
          </label>
          {unreadCount > 0 && (
            <button
              onClick={() => void handleMarkAll()}
              disabled={markAll.isPending}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-medium transition-colors hover:opacity-80"
              style={{
                border: `1px solid ${BRAND.border}`,
                color: BRAND.textSecondary,
                backgroundColor: BRAND.surface,
              }}
            >
              <CheckCheck size={13} />
              Mark all read
            </button>
          )}
        </div>
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div
              className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"
              style={{ borderColor: BRAND.primary, borderTopColor: 'transparent' }}
            />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <AlertTriangle size={28} style={{ color: BRAND.danger }} />
            <p className="text-[13px] font-medium" style={{ color: BRAND.textSecondary }}>
              Failed to load notifications. Please try again.
            </p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-xl"
              style={{ backgroundColor: '#e5ebf4' }}
            >
              <Bell size={26} style={{ color: BRAND.primary }} />
            </div>
            <div className="text-center">
              <p className="text-[15px] font-semibold" style={{ color: BRAND.textPrimary }}>
                {unreadOnly ? 'No unread notifications' : "You're all caught up"}
              </p>
              <p className="mt-1 text-[12px]" style={{ color: BRAND.textMuted }}>
                {unreadOnly
                  ? 'Switch off "Unread only" to see all.'
                  : 'New notifications will appear here.'}
              </p>
            </div>
          </div>
        ) : (
          <ul>
            {notifications.map((n) => (
              <li
                key={n.id}
                className="flex items-start gap-3 px-6 py-4 transition-colors hover:bg-[#f7f8fa]"
                style={{
                  borderBottom: `1px solid ${BRAND.borderInner}`,
                  backgroundColor: n.isRead ? undefined : '#f5f8ff',
                }}
              >
                {/* Read indicator */}
                <button
                  title={n.isRead ? 'Read' : 'Mark as read'}
                  disabled={n.isRead || markRead.isPending}
                  onClick={() => void markRead.mutateAsync(n.id)}
                  className="mt-0.5 shrink-0 transition-opacity hover:opacity-70 disabled:cursor-default"
                >
                  {n.isRead ? (
                    <Circle size={8} style={{ color: BRAND.border }} />
                  ) : (
                    <CircleDot size={8} style={{ color: BRAND.primary }} />
                  )}
                </button>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[13px] leading-5"
                    style={{ color: BRAND.textPrimary, fontWeight: n.isRead ? 400 : 600 }}
                  >
                    {n.title}
                  </p>
                  {n.body && (
                    <p
                      className="mt-0.5 line-clamp-2 text-[12px] leading-4"
                      style={{ color: BRAND.textSecondary }}
                    >
                      {n.body}
                    </p>
                  )}
                  <p className="mt-1 text-[11px]" style={{ color: BRAND.textMuted }}>
                    {relativeTime(n.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
