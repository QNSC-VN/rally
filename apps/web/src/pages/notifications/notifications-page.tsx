import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Bell, CheckCheck, Circle, CircleDot } from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { relativeTime } from '@/shared/lib/utils'
import { PageHeader } from '@/shared/ui/page-header'
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/features/notifications/api'

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'mentions', label: 'Mentions' },
] as const

type NotificationTab = (typeof TABS)[number]['key']

const TAB_FILTER: Record<
  NotificationTab,
  { unreadOnly?: boolean; category?: 'assigned' | 'mentions' }
> = {
  all: {},
  unread: { unreadOnly: true },
  assigned: { category: 'assigned' },
  mentions: { category: 'mentions' },
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<NotificationTab>('all')
  const { data: notifications = [], isLoading, isError } = useNotifications(TAB_FILTER[tab])
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()

  const unreadCount = notifications.filter((n) => !n.isRead).length

  function handleNotificationClick(n: {
    resourceType: string | null
    resourceId: string | null
    id: string
    isRead: boolean
  }) {
    // Mark as read then navigate
    if (!n.isRead) {
      void markRead.mutateAsync(n.id)
    }
    if (n.resourceType && n.resourceId) {
      const routeMap: Record<string, string> = {
        work_item: '/item/$itemKey',
        task: '/item/$itemKey',
        iteration: '/timeboxes',
        release: '/releases/$releaseId',
        milestone: '/milestones/$milestoneId',
        project: '/projects',
      }
      const route = routeMap[n.resourceType]
      if (route) {
        void navigate({
          to: route,
          params: { itemKey: n.resourceId, releaseId: n.resourceId, milestoneId: n.resourceId },
        })
      }
    }
  }

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
      <PageHeader
        icon={<Bell size={16} style={{ color: BRAND.textSecondary }} />}
        title="Notifications"
        badge={
          unreadCount > 0 ? (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
              style={{ backgroundColor: BRAND.primary }}
            >
              {unreadCount}
            </span>
          ) : undefined
        }
        actions={
          <>
            <div className="flex items-center gap-1">
              {TABS.map((t) => {
                const active = tab === t.key
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className="rounded px-3 py-1.5 text-[12px] font-medium transition-colors"
                    style={{
                      backgroundColor: active ? BRAND.primary : 'transparent',
                      color: active ? BRAND.surface : BRAND.textSecondary,
                      border: `1px solid ${active ? BRAND.primary : BRAND.border}`,
                    }}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>
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
          </>
        }
      />

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
              style={{ backgroundColor: BRAND.avatarBg }}
            >
              <Bell size={26} style={{ color: BRAND.primary }} />
            </div>
            <div className="text-center">
              <p className="text-[15px] font-semibold" style={{ color: BRAND.textPrimary }}>
                {tab === 'unread' ? 'No unread notifications' : "You're all caught up"}
              </p>
              <p className="mt-1 text-[12px]" style={{ color: BRAND.textMuted }}>
                {tab === 'all'
                  ? 'New notifications will appear here.'
                  : 'Switch to the All tab to see everything.'}
              </p>
            </div>
          </div>
        ) : (
          <ul>
            {notifications.map((n) => (
              <li
                key={n.id}
                className="flex cursor-pointer items-start gap-3 px-6 py-4 transition-colors hover:bg-[#f7f8fa]"
                style={{
                  borderBottom: `1px solid ${BRAND.borderInner}`,
                  backgroundColor: n.isRead ? undefined : '#f5f8ff',
                }}
                onClick={() => handleNotificationClick(n)}
              >
                {/* Read indicator */}
                <button
                  title={n.isRead ? 'Read' : 'Mark as read'}
                  disabled={n.isRead || markRead.isPending}
                  onClick={(e) => {
                    e.stopPropagation()
                    void markRead.mutateAsync(n.id)
                  }}
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
