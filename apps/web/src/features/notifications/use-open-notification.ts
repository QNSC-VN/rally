/**
 * useOpenNotification — the single source of truth for "what happens when a
 * notification row is clicked", shared by the bell popover and the full
 * Notification Center page so both stay behaviourally consistent.
 *
 * Responsibilities:
 *   1. Mark the notification read (if unread).
 *   2. Navigate to the deep-link target for the notification's resourceType.
 *
 * That is ALL it does, and the second point is the fix. This hook used to also switch the active
 * project to the notified item's own project, resolved out of the workspace's project LIST, before
 * navigating. Two things were wrong with that:
 *
 *   - It was on the CLICK, not on the ROUTE. Every target here is a workspace-unique identifier that
 *     the API resolves and authorizes from the row it loads, so `/item/US-42` and `/releases/:id` are
 *     valid links on their own — but the project adoption only ran when this handler ran. Clicking
 *     the bell entry landed in the right project context; the identical URL pasted into a chat, a
 *     bookmark or an email opened the right record labelled with the RECIPIENT's last-selected
 *     project. The route loaders own it now (`shared/lib/deep-link-project.ts`), so one code path
 *     serves the click and the shared link.
 *   - It resolved the project from `useProjects`, which fetches `limit: 100` and filters
 *     client-side, so past 100 projects the switch silently did not happen. The loader asks
 *     `GET /projects/{id}` for exactly the one project the record names.
 *
 * The old comment here also claimed `/item/$itemKey` "resolves the item by key WITHIN the active
 * project context, so a naive navigation 404s for cross-project items". That was already untrue:
 * `GET /work-items/by-key` takes no project and resolves against the whole workspace (item keys are
 * Rally FormattedIDs, unique per workspace). `metadata.projectId` is still load-bearing — the
 * notification repository filters the whole feed on it, so a reader never sees a bell entry naming a
 * project they cannot read — it is just not what routing needs.
 */
import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
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
  const markRead = useMarkNotificationRead()

  return useCallback(
    (n: Notification) => {
      if (!n.isRead) void markRead.mutateAsync(n.id)
      if (!n.resourceType) return
      const route = ROUTE_BY_RESOURCE[n.resourceType]
      if (!route) return

      if (route === '/item/$itemKey') {
        // `itemKey` is the human key the route addresses; `resourceId` (the work item's uuid) is the
        // fallback only for a row written before the templates threaded the key.
        const itemKey = typeof n.metadata?.itemKey === 'string' ? n.metadata.itemKey : n.resourceId
        if (!itemKey) return
        void navigate({ to: route, params: { itemKey } })
        return
      }

      void navigate({
        to: route,
        params: { releaseId: n.resourceId ?? undefined, milestoneId: n.resourceId ?? undefined },
      })
    },
    [markRead, navigate],
  )
}
