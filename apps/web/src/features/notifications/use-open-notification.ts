/**
 * useOpenNotification — the single source of truth for "what happens when a
 * notification row is clicked", shared by the bell popover and the full
 * Notification Center page so both stay behaviourally consistent.
 *
 * Responsibilities:
 *   1. Mark the notification read (if unread).
 *   2. Resolve the deep-link target from the notification's resourceType.
 *
 * Work-item / task deep links are the subtle case: notifications are
 * workspace-wide and may reference an item in a project OTHER than the one the
 * user is currently viewing. The `/item/$itemKey` route resolves the item by key
 * WITHIN the active project context, so a naive navigation 404s for cross-project
 * items. The relay stamps `{ itemKey, projectId }` into `metadata`; we switch the
 * active project to the item's own project first, then reuse the exact same
 * `/item/$itemKey` route every other in-app caller uses (DRY — one route, one
 * detail page).
 */
import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjects } from '@/features/projects/api'
import { useMarkNotificationRead, type Notification } from './api'

/** resourceType → target route. Constant, module-level (shared by every caller). */
const ROUTE_BY_RESOURCE: Record<string, string> = {
  work_item: '/item/$itemKey',
  task: '/item/$itemKey',
  iteration: '/timeboxes',
  release: '/releases/$releaseId',
  milestone: '/milestones/$milestoneId',
  project: '/projects',
}

/** Returns a handler that opens a notification's target resource. */
export function useOpenNotification(): (n: Notification) => void {
  const navigate = useNavigate()
  const { workspace, setProject } = useAppContext()
  const { data: projects = [] } = useProjects(workspace?.workspaceId)
  const markRead = useMarkNotificationRead()

  return useCallback(
    (n: Notification) => {
      if (!n.isRead) void markRead.mutateAsync(n.id)
      if (!n.resourceType) return
      const route = ROUTE_BY_RESOURCE[n.resourceType]
      if (!route) return

      if (route === '/item/$itemKey') {
        // Deep-link via metadata: itemKey is the human key, projectId locates the
        // owning project. Fall back to resourceId only if metadata is absent.
        const itemKey =
          typeof n.metadata?.itemKey === 'string' ? n.metadata.itemKey : n.resourceId
        const projectId = typeof n.metadata?.projectId === 'string' ? n.metadata.projectId : null
        if (!itemKey) return
        if (projectId) {
          const target = projects.find((p) => p.id === projectId)
          if (target) {
            setProject({
              projectId: target.id,
              projectKey: target.key,
              projectName: target.name,
            })
          }
        }
        void navigate({ to: route, params: { itemKey } })
        return
      }

      void navigate({
        to: route,
        params: { releaseId: n.resourceId ?? undefined, milestoneId: n.resourceId ?? undefined },
      })
    },
    [markRead, navigate, projects, setProject],
  )
}
