/**
 * `/releases/$releaseId` — resolve the release, then adopt ITS project.
 *
 * Counterpart to `features/work-items/deep-link.ts`; see that file for why this lives on the route.
 * A release id is workspace-unique and `GET /releases/:id` resolves the owning project from the row
 * through `PolicyGuard`'s `resource: 'release'` scope resolver before checking `release:view`, so the
 * URL needs no project and a link reaches any release the caller is allowed to read.
 */
import type { QueryClient } from '@tanstack/react-query'
import { adoptRecordProject } from '@/shared/lib/deep-link-project'
import { releaseQueryOptions } from './api'

export async function adoptReleaseProject(
  queryClient: QueryClient,
  releaseId: string,
  /**
   * The loader's own `cause`. `'preload'` fires on HOVER under `defaultPreload: 'intent'`, and a
   * hover must not switch the app's project — see {@link adoptRecordProject} for the search-box
   * case this was reachable through. The fetch still happens either way.
   */
  cause: 'preload' | 'enter' | 'stay' = 'enter',
): Promise<void> {
  const release = await queryClient
    .ensureQueryData(releaseQueryOptions(releaseId))
    // Swallowed deliberately — a 403 already redirects to `/403` and a 404 is the page's own
    // error state; a throwing loader would replace both with the router's error boundary.
    .catch(() => null)
  await adoptRecordProject(queryClient, release?.projectId, { commit: cause !== 'preload' })
}
