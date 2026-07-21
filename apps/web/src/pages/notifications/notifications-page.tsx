import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('notifications')
  const [tab, setTab] = useState<NotificationTab>('all')
  const { data: notifications = [], isLoading, isError } = useNotifications(TAB_FILTER[tab])
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const openNotification = useOpenNotification()

  const unreadCount = notifications.filter((n) => !n.isRead).length

  async function handleMarkAll() {
    try {
      await markAll.mutateAsync()
      toast.success(t('markAllSuccess'))
    } catch {
      toast.error(t('markAllError'))
    }
  }

  return (
    <div className="flex flex-1 flex-col bg-background" style={{ minHeight: 0 }}>
      {/* ── Header ── */}
      <PageHeader
        icon={<Bell size={16} className="text-muted-foreground" />}
        title={t('common:notifications')}
        badge={
          unreadCount > 0 ? (
            <span className="rounded-full bg-primary px-2 py-0.5 text-ui-sm font-semibold text-white">
              {unreadCount}
            </span>
          ) : undefined
        }
        actions={
          <>
            <div className="flex items-center gap-1">
              {TABS.map((type) => {
                const active = tab === type.key
                return (
                  <button
                    key={type.key}
                    onClick={() => setTab(type.key)}
                    className="rounded px-3 py-1.5 text-ui-md font-medium transition-colors"
                    style={{
                      backgroundColor: active ? BRAND.primary : 'transparent',
                      color: active ? BRAND.surface : BRAND.textSecondary,
                      border: `1px solid ${active ? BRAND.primary : BRAND.border}`,
                    }}
                  >
                    {t(`tabs.${type.key}`)}
                  </button>
                )
              })}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() => void handleMarkAll()}
                disabled={markAll.isPending}
                className="flex items-center gap-1.5 rounded border border-border-strong bg-card px-3 py-1.5 text-ui-md font-medium text-muted-foreground transition-colors hover:opacity-80"
              >
                <CheckCheck size={13} />
                {t('markAllRead')}
              </button>
            )}
          </>
        }
      />

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : isError ? (
          <EmptyState
            icon={<AlertTriangle size={28} className="text-destructive" />}
            title={t('errors.load')}
          />
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={<Bell size={28} className="text-foreground-subtle" />}
            title={tab === 'unread' ? t('empty.noUnread') : t('empty.caughtUp')}
            description={tab === 'all' ? t('empty.allDescription') : t('empty.otherDescription')}
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
