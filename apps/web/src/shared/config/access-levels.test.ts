/**
 * `coversAllTeams` — the SPA's only inference of "is this caller a team-scoped Editor here?".
 *
 * BA ruling 2026-08-17: the Project Backlog (`team_id IS NULL`) belongs to a Workspace Admin and a
 * per-project Admin, and an Editor "must select one of their assigned Teams when creating a Work
 * Item and cannot access team-less items". The server answers that from the LEVEL
 * (`AccessService.resolveTeamScope`); no endpoint hands the SPA its own level for a project, so the
 * client infers it from permission CODES — and this file is why that inference is one function and
 * not three inline comparisons. Every create surface's Team rule hangs off it.
 *
 * Both directions matter. Reading an admin as an Editor takes the Project Backlog away from the
 * caller it belongs to; reading an Editor as an admin offers a choice the server answers with a 412.
 *
 * The role sets are `db/permissions.catalog.ts`' — imported there rather than here, because a
 * dependency-free mirror is the whole point of `shared/config`. Keep them in step: a code moving
 * between `PROJECT_ADMIN` and `PROJECT_MEMBER` changes the answer below.
 */
import { describe, expect, it } from 'vitest'

import { coversAllTeams } from './access-levels'
import { PERMISSION } from './permissions'

/** `db/permissions.catalog.ts` → `ROLE_PERMISSIONS[PROJECT_MEMBER]`, which is `editor`'s set. */
const EDITOR_PERMISSIONS = [
  PERMISSION.PROJECT_VIEW,
  PERMISSION.WORK_ITEM_VIEW,
  PERMISSION.ITERATION_VIEW,
  PERMISSION.QUALITY_VIEW,
  PERMISSION.TEAM_STATUS_VIEW,
  // Literals, not `PERMISSION.*`: that map deliberately holds only the codes the SPA GATES on, and
  // these three are write codes no client control reads. Spelling them out keeps the fixture faithful
  // to `ROLE_PERMISSIONS[PROJECT_MEMBER]` without widening the map to make a test compile.
  'work_item:create',
  'work_item:edit',
  'work_item:delete',
]

/** The three admin-surface codes the predicate reads, all held by `PROJECT_ADMIN`. */
const PROJECT_ADMIN_MARKERS = [
  PERMISSION.TIMEBOX_VIEW,
  PERMISSION.PORTFOLIO_VIEW,
  PERMISSION.CAPACITY_VIEW,
]

describe('coversAllTeams', () => {
  it('is FALSE for a project Editor — every delivery code they hold, and no admin surface', () => {
    expect(coversAllTeams(EDITOR_PERMISSIONS)).toBe(false)
  })

  it('is TRUE for a per-project Admin', () => {
    expect(coversAllTeams([...EDITOR_PERMISSIONS, ...PROJECT_ADMIN_MARKERS])).toBe(true)
  })

  it('is TRUE for a Workspace Admin, from the `workspace:*` wildcard alone', () => {
    // No entry is needed for a WA: `grants()` answers true for every code under the wildcard, which
    // is the same rule the route guards use — so the two cannot disagree about who is unrestricted.
    expect(coversAllTeams([PERMISSION.WORKSPACE_ALL])).toBe(true)
  })

  it.each(PROJECT_ADMIN_MARKERS)('is TRUE from %s on its own', (code) => {
    // ANY of the three, deliberately: a future ruling handing an Editor one admin surface must not
    // silently re-open the Project Backlog to them. See the predicate's docblock.
    expect(coversAllTeams([code])).toBe(true)
  })

  it('is FALSE for a principal with no permissions at all', () => {
    // The restrictive direction for the unknown case. Such a caller cannot create anything anyway —
    // `assertProjectPermission` refuses them first — so requiring a Team costs nothing, while
    // offering the Project Backlog would put a control on screen for the least privileged reader.
    expect(coversAllTeams([])).toBe(false)
  })
})
