/**
 * The Parent Story picker's feed — a Defect's eligible User Stories in one project.
 *
 * Its own file rather than a section of `api.ts`: that module is the SPA's file-length ratchet
 * holder (`fe-consistency.ratchet.test.ts`), and this feed is a self-contained question with one
 * consumer shape. Re-exported from `api.ts` so call sites still import from the one barrel.
 */
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

/**
 * Its own cache key, deliberately NOT derived from `workItemKeys` in `api.ts`: that module
 * re-exports this one, and reaching back into it for a key would make the pair circular for the
 * sake of four characters of prefix. The prefix is the same, so a broad `['work-items']`
 * invalidation still reaches this feed.
 */
const storyOptionsKey = (projectId: string) => ['work-items', 'story-options', projectId] as const

/** One row of the Story REFERENCE feed — the picker behind a Defect's `Parent Story` field. */
export interface StoryOption {
  id: string
  itemKey: string
  title: string
  projectId: string
}

/**
 * Every User Story in one project that a Defect may name as its Parent Story.
 *
 * WHY NOT {@link useBacklog} with `{ type: 'story' }`, which all three Parent Story pickers used
 * to call. `GET /v1/work-items/backlog` is the Backlog SCREEN's feed and carries that screen's
 * defining rule — only UNSCHEDULED items (`iteration_id IS NULL`) — plus a 50-row first page. So a
 * Story pulled into any iteration silently left the picker, and `SearchableSelect` filters the
 * options it was HANDED, which is why searching for it answered "No matches" rather than nothing at
 * all. The server never had this restriction: `updateWorkItem` accepts any non-deleted Story in the
 * same project as a Defect's parent.
 *
 * Read whole (no paging): the route is unpaged by design, since a paged picker omits options past
 * its first page without saying so.
 *
 * Pass the DEFECT's project, not the app-context one — the two differ whenever a reader opens an
 * item by deep link, and the parent must share the Defect's project.
 */
export function useStoryOptions(projectId: string | undefined) {
  return useQuery({
    queryKey: storyOptionsKey(projectId ?? ''),
    queryFn: async () => {
      if (!projectId) return []
      const { data, error, response } = await apiClient.GET('/v1/work-items/story-options', {
        params: { query: { projectId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as StoryOption[] | undefined) ?? []
    },
    enabled: !!projectId,
    staleTime: 60_000,
  })
}
