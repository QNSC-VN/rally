import { useState } from 'react'
import { AlertTriangle, Bell, CheckCheck } from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { PageHeader } from '@/shared/ui/page-header'
import { EmptyState } from '@/shared/ui/empty-state'
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/features/notifications/api'
import { useOpenNotification } from '@/features/notifications/use-open-notification'
import { NotificationItem } from '@/features/notifications/ui/notification-item'

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
  const [tab, setTab] = useState<NotificationTab>('all')
  const { data: notifications = [], isLoading, isError } = useNotifications(TAB_FILTER[tab])
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const openNotification = useOpenNotification()

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
          <EmptyState
            icon={<AlertTriangle size={28} className="text-destructive" />}
            title="Failed to load notifications. Please try again."
          />
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={<Bell size={28} className="text-foreground-subtle" />}
            title={tab === 'unread' ? 'No unread notifications' : "You're all caught up"}
            description={
              tab === 'all'
                ? 'New notifications will appear here.'
                : 'Switch to the All tab to see everything.'
            }
          />
        ) : (
          <ul>
            {notifications.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onMarkRead={(id) => void markRead.mutateAsync(id)}
                isMarkingRead={markRead.isPending}
                onActivate={() => openNotification(n)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
