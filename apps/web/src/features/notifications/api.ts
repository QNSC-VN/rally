/**
 * Notifications feature API hooks.
 */
import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { ENV } from '@/shared/config/env'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  resourceType: string | null
  resourceId: string | null
  /** Structured deep-link payload, e.g. { itemKey, projectId } for work items. */
  metadata: Record<string, unknown>
  isRead: boolean
  readAt: string | null
  actorId: string | null
  createdAt: string
}

// ── Unread count ─────────────────────────────────────────────────────────────

export function useNotificationUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const { data, error } = await apiClient.GET('/v1/notifications/unread-count')
      if (error) return 0
      return (data as { count: number }).count
    },
    staleTime: 30_000,
    // Fallback poll — only fires when SSE is not active (e.g. unsupported browser).
    // The SSE hook drives unread-count updates in real time; poll is a safety net.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
}

// ── Notification list ─────────────────────────────────────────────────────────

/** Notification Center category tabs (server maps these to notification types). */
export type NotificationCategory = 'assigned' | 'mentions'

export function useNotifications(
  filter: { unreadOnly?: boolean; category?: NotificationCategory } = {},
) {
  const { unreadOnly = false, category } = filter
  return useQuery({
    queryKey: ['notifications', 'list', unreadOnly, category ?? 'all'],
    queryFn: async () => {
      const query: { unreadOnly?: string; category?: NotificationCategory } = {}
      if (unreadOnly) query.unreadOnly = 'true'
      if (category) query.category = category
      const { data, error, response } = await apiClient.GET('/v1/notifications', {
        params: { query },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as Notification[]) ?? []
    },
    staleTime: 30_000,
  })
}

// ── Mark as read ─────────────────────────────────────────────────────────────

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.POST('/v1/notifications/{id}/read', {
        params: { path: { id } },
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await apiClient.POST('/v1/notifications/read-all', {})
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

// ── SSE real-time stream ──────────────────────────────────────────────────────
// Uses fetch-based SSE (not EventSource) so we can send the Authorization header.
// On `connected` event: seeds the unread-count cache directly.
// On `notification` event: invalidates the list so it refetches.
// Reconnects automatically on network errors or server restart hints.
// Tracks the last `id:` field and sends `Last-Event-ID` on reconnect so the
// server can replay any missed notifications (SSE spec §9.2 + backend replay).

export function useNotificationSse(
  onNewNotification?: (payload: { title: string; body: string | null }) => void,
) {
  const qc = useQueryClient()

  useEffect(() => {
    let aborted = false
    let lastEventId: string | null = null // persisted across reconnects
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null
    const controller = new AbortController()

    function scheduleReconnect(delayMs: number) {
      if (!aborted) reconnectTimer = setTimeout(connect, delayMs)
    }

    async function connect() {
      reconnectTimer = null

      // Cookie-authenticated via __Host-rally_session (the browser holds no
      // token); the shared guard refreshes the access token server-side.
      const headers: Record<string, string> = {}
      if (lastEventId) headers['Last-Event-ID'] = lastEventId

      try {
        const res = await fetch(`${ENV.API_BASE_URL}/v1/notifications/stream`, {
          headers,
          credentials: 'include',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          scheduleReconnect(5_000)
          return
        }

        const reader = res.body.getReader()
        activeReader = reader
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent = ''
        let currentData = ''
        let currentId = ''

        while (!aborted) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              currentData = line.slice(6).trim()
            } else if (line.startsWith('id: ')) {
              currentId = line.slice(4).trim()
            } else if (line === '') {
              // Blank line = dispatch the completed event
              if (currentId) lastEventId = currentId

              if (currentEvent === 'connected') {
                try {
                  const parsed = JSON.parse(currentData) as { unreadCount: number }
                  qc.setQueryData(['notifications', 'unread-count'], parsed.unreadCount)
                } catch {
                  /* ignore malformed */
                }
              } else if (currentEvent === 'notification') {
                void qc.invalidateQueries({ queryKey: ['notifications'] })
                try {
                  const parsed = JSON.parse(currentData) as { title: string; body: string | null }
                  onNewNotification?.(parsed)
                } catch {
                  /* ignore malformed */
                }
              }
              // `reconnect` event — hint from server on graceful shutdown
              else if (currentEvent === 'reconnect') {
                scheduleReconnect(3_000)
                return
              }
              currentEvent = ''
              currentData = ''
              currentId = ''
            }
            // SSE comments (": heartbeat") — ignore
          }
        }
      } catch (err) {
        // Ignore abort errors — component unmounted intentionally
        if (err instanceof DOMException && err.name === 'AbortError') return
        // Network error — reconnect after 5s
        scheduleReconnect(5_000)
        return
      }

      scheduleReconnect(5_000)
    }

    void connect()

    return () => {
      aborted = true
      controller.abort()
      activeReader?.cancel().catch(() => {
        /* noop */
      })
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    }
    // Intentionally empty deps — connect runs once; token is read dynamically inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
