/**
 * `/item/$itemKey` — resolve the item, then adopt ITS project.
 *
 * Called from the route loader, so it runs for a pasted, bookmarked or emailed link exactly as it
 * does for an in-app click. The project switch used to live in `useOpenNotification` instead, i.e. on
 * the notification CLICK handler, which is why a shared link opened the right item labelled with the
 * recipient's last-selected project.
 *
 * Note what is NOT here: no project id is read out of the URL, and none is needed. Item keys are
 * Rally FormattedIDs, unique per WORKSPACE, and `GET /work-items/by-key` deliberately carries no
 * `@RequirePermission` — it loads the row and then asserts `work_item:view` on the row's own project.
 * A gate that guessed the project from the URL would be the trap CLAUDE.md names: a gate chosen for
 * where the id lives rather than for what the action is.
 */
import type { QueryClient } from '@tanstack/react-query'
import { adoptRecordProject } from '@/shared/lib/deep-link-project'
import { workItemByKeyQueryOptions } from './api'

export async function adoptWorkItemProject(
  queryClient: QueryClient,
  itemKey: string,
): Promise<void> {
  const item = await queryClient
    .ensureQueryData(workItemByKeyQueryOptions(itemKey))
    // Swallowed deliberately: a 403 is already handled globally (the HTTP client redirects to
    // `/403`) and a 404 belongs to the page's own "not found" state. A loader that threw would
    // replace both with the router's error boundary.
    .catch(() => null)
  await adoptRecordProject(queryClient, item?.projectId)
}
