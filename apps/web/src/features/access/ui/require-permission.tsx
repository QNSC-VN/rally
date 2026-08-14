/**
 * RequirePermission — the route-level gate that makes a typed or bookmarked URL agree with the nav.
 *
 * WHY THIS IS A COMPONENT AND NOT A ROUTER `beforeLoad`
 * ----------------------------------------------------
 * Permissions arrive from `GET /projects/:id/my-permissions` (`useProjectPermissions`), a react-query
 * read scoped to the SELECTED project. A `beforeLoad` runs once, before render, and would therefore
 * have to decide while its own source was still in flight — denying a legitimate Project Admin on a
 * cold load. `CLAUDE.md` records that exact shape ("state FROZEN before its source arrived": the
 * user-access modal materialised `teamIds` before `/teams/{id}/members` resolved and could never
 * recover, presenting as a flaky test). A component re-renders when the answer lands, so the three
 * phases below can each render what is actually true at the time.
 *
 * THE PENDING SIGNAL, AND WHY THIS ONE
 * ------------------------------------
 * `useProjectPermissions` already exposes `isLoading` (react-query's `isPending && isFetching`), and
 * that is what is used here. It is the only signal that means "in flight" and nothing else:
 *   • an EMPTY `permissions` array is not a pending signal — it is also the legitimate answer for a
 *     No-Access principal, and conflating absent with empty is the bug the `query-default` ratchet
 *     exists to shrink;
 *   • `!can(code)` is not one either, for the same reason.
 * With no project selected the query is disabled, so `isLoading` is `false` and the hook falls back
 * to the workspace baseline — correct, not a gap: the project context is persisted zustand state
 * that hydrates synchronously, so there is no async source to wait on, and the nav resolves that
 * state identically. Nav and route stay in step by construction.
 *
 * Order matters. `can()` is checked FIRST, before `isLoading`, because the hook's effective set is a
 * SUPERSET of the workspace baseline (the model is purely additive — its own docblock says so). A
 * Workspace Admin's `workspace:*` therefore grants immediately and never flashes a spinner, and no
 * grant that will exist after the fetch is withheld before it.
 *
 * `isError` renders the children, NOT a denial. A failed permission read is an absent answer, and
 * "we could not ask" is not "you may not"; claiming otherwise would be the same absent-versus-error
 * conflation in a new place. The page's own request is the one that then reports the failure.
 *
 * UX ONLY. The server is the authorization boundary: every route behind these surfaces carries
 * `@RequirePermission` and `PolicyGuard` refuses independently of anything rendered here. This exists
 * so a bookmark stops rendering an empty grid that reads as data — Phase 4
 * `02_Roles_Permissions/SRS.md:197`, "A known route without sufficient action permission shows
 * Access Denied."
 */
import type { ReactNode } from 'react'

import { useProjectPermissions } from '@/features/access/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { AccessDenied } from '@/shared/ui/access-denied'
import { PageSpinner } from '@/shared/ui/spinner'

export function RequirePermission({
  /**
   * The nav's own code for this path, from `navPermissionFor()`. `undefined` means the nav gates the
   * surface on nothing (e.g. Home), so neither does this.
   */
  code,
  children,
}: {
  code?: string
  children: ReactNode
}) {
  const projectId = useAppContext((s) => s.project?.projectId)
  const { can, isLoading, isError } = useProjectPermissions(projectId)

  if (!code || can(code)) return <>{children}</>
  // Resolving: render the page's normal loading affordance. NEVER a denial — a denial asserted
  // before the answer arrived is a claim about the reader made on no evidence.
  if (isLoading) return <PageSpinner />
  if (isError) return <>{children}</>
  return <AccessDenied />
}
