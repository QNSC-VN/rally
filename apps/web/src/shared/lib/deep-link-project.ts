/**
 * A deep link resolves its OWN project. The selector never decides it.
 *
 * Every entity route in this app addresses a workspace-unique identifier — `/item/US-42` by item
 * key, `/releases/:id` by uuid — and the API resolves the owning project from the row it loads
 * before authorizing (`GET /work-items/by-key` does it in the service; `GET /releases/:id` does it
 * through `PolicyGuard`'s `resource: 'release'` scope resolver). So the URL does NOT need to carry a
 * project key for a shared or bookmarked link to reach the right record, and it never did.
 *
 * What was broken is narrower and entirely client-side: three surfaces read the *identity* of the
 * record's project out of `useAppContext()` — the recipient's LAST-SELECTED project — instead of out
 * of the record they had just loaded. A link to a PAY release opened the right release and labelled
 * it `NXP`, and gated its editors on the caller's NXP permissions.
 *
 * Two entry points, one rule:
 *
 *  - {@link adoptRecordProject} is for a ROUTE loader. It belongs there because a deep link is a
 *    property of the route, not of whatever clicked it: the project switch used to live in
 *    `useOpenNotification`, i.e. on the CLICK handler, so an in-app notification click landed in the
 *    right context and the same URL pasted into Slack did not. One code path now serves both.
 *  - {@link useRecordProject} is for a page that DISPLAYS the project. It never falls back to the
 *    selected project — an absent value renders `EMPTY_VALUE` (`--`), which is honest, where the
 *    selected project would be a confident lie for one paint.
 *
 * Both share one query key, so the loader's fetch warms the cache the page reads: adopting a
 * project costs one request per project, not one per surface.
 */
import { useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAppContext, type ProjectContext } from '@/shared/lib/stores/app-context.store'

/** Distinct from `['projects', workspaceId]` (the shell's list) — this is one project by id. */
export const recordProjectKeys = {
  detail: (projectId: string) => ['project', projectId] as const,
}

/**
 * `GET /v1/projects/{id}` mapped straight onto {@link ProjectContext}.
 *
 * Deliberately NOT resolved out of the shell's `useProjects` list: that call is `limit: 100` and
 * filtered client-side, so past 100 projects a deep-linked record's project would silently fail to
 * resolve. This route is also correctly gated (`project:view` scoped to the path id), so a caller
 * who cannot read the project gets a 403 here rather than a name they should not see.
 */
export function recordProjectQueryOptions(projectId: string) {
  return {
    queryKey: recordProjectKeys.detail(projectId),
    queryFn: async (): Promise<ProjectContext | null> => {
      const { data, error, response } = await apiClient.GET('/v1/projects/{id}', {
        params: { path: { id: projectId } },
      })
      if (error) {
        if (response.status === 404) return null
        throw new Error(apiErrorMessage(error, response.status))
      }
      if (!data) return null
      return { projectId: data.id, projectKey: data.key, projectName: data.name }
    },
    staleTime: 60_000,
  }
}

/**
 * Make a deep-linked record's project the active context, for the app shell's benefit.
 *
 * Call from a route `loader`, after the record itself is in cache. Resolves before the first paint,
 * so the breadcrumb, the project selector and every widget that reads the selected project are
 * already correct on the deep link's first frame — no flicker through the previous project.
 *
 * Swallows a failure on purpose. A 403 is already handled globally (the HTTP client redirects to
 * `/403`) and a 404 belongs to the page's own empty state; a loader that threw would replace both
 * with the router's error boundary.
 */
export async function adoptRecordProject(
  queryClient: QueryClient,
  projectId: string | null | undefined,
): Promise<void> {
  if (!projectId) return
  if (useAppContext.getState().project?.projectId === projectId) return

  const resolved = await queryClient
    .ensureQueryData(recordProjectQueryOptions(projectId))
    .catch(() => null)
  if (!resolved) return

  // Re-read the store: this is an await boundary, and the caller may have picked a project in the
  // meantime. Losing that race would move them off their own choice.
  const { project, setProject, setTeam } = useAppContext.getState()
  if (project?.projectId === projectId) return
  setProject(resolved)
  // The Team belongs to the project being left, exactly as in the shell's own project switcher.
  setTeam(null)
}

/**
 * The project a RECORD belongs to, for display.
 *
 * Returns `undefined` until it is known — including while the selected project is a different one.
 * That is the point: `ProjectCell` renders `--` for `undefined`, and a placeholder that resolves in
 * a moment is strictly better than the wrong project name rendered with confidence.
 */
export function useRecordProject(projectId: string | undefined): ProjectContext | undefined {
  const selected = useAppContext((s) => s.project)
  const { data } = useQuery({ ...recordProjectQueryOptions(projectId ?? ''), enabled: !!projectId })
  if (!projectId) return undefined
  if (data) return data
  return selected?.projectId === projectId ? selected : undefined
}
