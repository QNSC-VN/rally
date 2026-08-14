/**
 * The top-nav table — and, derived from the SAME rows, the path → permission map the ROUTER gates on.
 *
 * The defect this file exists to close
 * ------------------------------------
 * The nav hid an item the caller lacked the permission for (`navItemState` in
 * `widgets/app-shell/app-shell.tsx`), and the router carried NO permission check at all — routes
 * only required authentication. So `/portfolio` typed, bookmarked or pasted rendered the page for a
 * caller whose nav did not offer it. That was harmless only while the server over-granted; with the
 * per-project access model in force, a project Editor's Portfolio request now legitimately returns
 * nothing, so the surface rendered an EMPTY GRID — which reads as "this project has no Features"
 * rather than "you cannot see this". Phase 4 `02_Roles_Permissions/SRS.md:197`: "A known route
 * without sufficient action permission shows Access Denied." (§198's Not-Found masking is for a
 * specific record id whose existence is sensitive; a top-level surface's absence from the nav
 * already discloses nothing, so Access Denied is the correct state here.)
 *
 * It lives in `shared/config` rather than in the widget so that BOTH readers can have it: the shell
 * is a `widgets/` module and the router is `app/`, and while `app → widgets` is a legal FSD edge, a
 * nav TABLE is configuration, not shell internals. The one thing that must never happen again is a
 * second copy of these codes: nav-hidden and route-open can only disagree if the pairing is written
 * down twice.
 *
 * UX ONLY. The server is the authorization boundary and already refuses these requests — see
 * `PolicyGuard` and `AccessService.listReadableProjectIds`. Nothing here is a security control; it
 * stops a bookmark from rendering an empty grid that reads as data.
 */

import { PERMISSION } from '@/shared/config/permissions'

export interface SubNavItem {
  path: string
  label: string
  permission?: string
  featureFlag?: string
}

export interface NavItem {
  path: string
  label: string
  /** Permission code required to see this nav item. Undefined = any authenticated user. */
  permission?: string
  /** Feature flag key. When false this feature is not yet built; shows as "coming soon". */
  featureFlag?: string
  children?: SubNavItem[]
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Home' },
  {
    path: '/backlog',
    label: 'Plan',
    featureFlag: 'feature.backlog',
    permission: PERMISSION.WORK_ITEM_VIEW,
    children: [
      {
        path: '/backlog',
        label: 'Backlog',
        featureFlag: 'feature.backlog',
        permission: PERMISSION.WORK_ITEM_VIEW,
      },
      {
        // Releases and Milestones are NOT separate Plan entries — they are TYPE
        // modes inside this one Timeboxes screen, reached via its TYPE dropdown
        // (TimeboxTypeSwitcher). Matches the BA mockup and DEV_HANDOFF.md
        // ("Release management remains under Plan > Timeboxes"). Was gap DEV-004.
        path: '/timeboxes',
        label: 'Timeboxes',
        featureFlag: 'feature.timeboxes',
        // `timebox:view`, NOT `iteration:view`. §3.2 marks `Plan > Timeboxes` Hidden for
        // an Editor, but every level holds `iteration:view` (Iteration Status, the Backlog
        // filter and Team Status all read the iteration list), so gating on it rendered the
        // entry for a level the BA hides — and its Releases/Milestones modes then 403'd.
        permission: PERMISSION.TIMEBOX_VIEW,
      },
    ],
  },
  {
    path: '/iteration-status',
    label: 'Track',
    featureFlag: 'feature.iteration-status',
    permission: PERMISSION.WORK_ITEM_VIEW,
    children: [
      {
        path: '/iteration-status',
        label: 'Iteration Status',
        featureFlag: 'feature.iteration-status',
        permission: PERMISSION.WORK_ITEM_VIEW,
      },
      {
        path: '/team-status',
        label: 'Team Status',
        featureFlag: 'feature.team-status',
        permission: PERMISSION.WORK_ITEM_VIEW,
      },
    ],
  },
  {
    path: '/quality/defects',
    label: 'Quality',
    featureFlag: 'feature.quality',
    permission: PERMISSION.WORK_ITEM_VIEW,
    children: [
      {
        path: '/quality/defects',
        label: 'Defects',
        featureFlag: 'feature.quality',
        permission: PERMISSION.WORK_ITEM_VIEW,
      },
    ],
  },
  {
    path: '/portfolio',
    label: 'Portfolio',
    featureFlag: 'feature.portfolio',
    permission: PERMISSION.PROJECT_VIEW,
    // SoT §4: Portfolio is a dropdown. Through Phase 4 its only child was a
    // "Release Planning" placeholder pointing at /portfolio; Phase 5 fills both
    // surfaces in, so the placeholder becomes two real entries. Real Release
    // MANAGEMENT still lives under Plan > Timeboxes > Releases — this dropdown is
    // portfolio items and capacity.
    //
    // RALLY PARITY (corrects an earlier note in this file)
    // Rally: has BOTH pages, and they are different products. "Capacity Planning"
    // is its own page under Portfolio — "Select Portfolio, Capacity Planning" — with
    // a plan object, a draft/published lifecycle and per-team allocations. "Release
    // Planning" is a separate board under Planning (backlog column + release columns,
    // drag a card to schedule); it has no plan object and no lifecycle.
    // https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/capacity-planning-page/creating-a-capacity-plan/create-a-capacity-plan.html
    // Our Capacity Planning maps to Rally's Capacity Planning, NOT to Release
    // Planning. The previous note here claimed the opposite and was wrong; it sent a
    // research pass down a false trail before being caught.
    // Decided 2026-08-04. See 09_Gap_Audit/PHASE_5_6_DECISION_MATRIX.md#P5-CP-1
    children: [
      {
        // "Portfolio Items", not "Portfolio": a child repeating its parent's label reads as a
        // link back to the menu, and the page lists Epics and Features — items.
        path: '/portfolio',
        label: 'Portfolio Items',
        featureFlag: 'feature.portfolio',
        permission: PERMISSION.PORTFOLIO_VIEW,
      },
      {
        path: '/capacity-planning',
        label: 'Capacity Planning',
        featureFlag: 'feature.portfolio',
        permission: PERMISSION.CAPACITY_VIEW,
      },
      {
        // Third and LAST in the Portfolio menu (RT-AC-01), which is where the SRS puts it.
        path: '/release-tracking',
        label: 'Release Tracking',
        featureFlag: 'feature.release-tracking',
        permission: PERMISSION.REPORT_VIEW,
      },
    ],
  },
  {
    path: '/reports',
    label: 'Reports',
    featureFlag: 'feature.reports',
    permission: PERMISSION.REPORT_VIEW,
  },
]

/**
 * path → permission code, flattened from {@link NAV_ITEMS}. **A CHILD OVERRIDES ITS PARENT.**
 *
 * A parent row's `path` is only the dropdown's default destination, so where the two disagree the
 * LEAF is the row that describes the surface. `/portfolio` is the live case: the Portfolio menu
 * trigger carries `project:view` (held by every access level, so the menu itself stays visible),
 * while `Portfolio Items` carries `portfolio:view`. Reading the parent would have guarded the route
 * with a code an Editor holds and left the empty grid exactly as it was.
 *
 * A path with no permission on either row is absent from this map, and that is a real answer:
 * `/` (Home) is open to any authenticated caller.
 */
/**
 * Paths that are ANOTHER ENTRY INTO A NAV SURFACE rather than surfaces of their own.
 *
 * Deriving the map from {@link NAV_ITEMS} alone leaves a hole exactly where the nav is a Type
 * SWITCH: `Plan > Timeboxes` is one screen with three modes, and only the Iterations mode owns the
 * nav row. `/releases` and `/milestones` say so themselves — both carry
 * `staticData.breadcrumb: 'Timeboxes'` in `router.tsx` — so a caller the nav denies `/timeboxes` to
 * could bookmark `/releases` and render the same surface, which is the whole defect this map exists
 * to close. §3.2:83 puts "Releases and Milestones" Hidden for an Editor in the same row as
 * Timeboxes, so one code covers all three.
 *
 * DELIBERATELY NOT HERE: the record routes `/releases/$releaseId`, `/milestones/$milestoneId`,
 * `/portfolio/$itemId`, `/capacity-planning/$planId`. Those are §198's case — "a missing item,
 * inaccessible Project or guessed identifier may show Not Found to avoid metadata disclosure" — and
 * Access Denied on a specific id discloses that the id EXISTS. Which of the two those should render
 * is a BA read, not a wrapper, and it is open.
 *
 * Keep this table SMALL. An entry here is a claim that two paths are one surface; anything that is
 * genuinely its own surface belongs in the nav table with its own code.
 */
const NAV_PATH_ALIASES: Record<string, string> = {
  '/releases': '/timeboxes',
  '/milestones': '/timeboxes',
}

export const NAV_PERMISSIONS: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  for (const item of NAV_ITEMS) {
    if (item.permission) map.set(item.path, item.permission)
    for (const child of item.children ?? []) {
      if (child.permission) map.set(child.path, child.permission)
    }
  }
  // Aliases fold in LAST and never overwrite: a real nav row always describes its own surface.
  for (const [alias, surface] of Object.entries(NAV_PATH_ALIASES)) {
    const code = map.get(surface)
    if (code !== undefined && !map.has(alias)) map.set(alias, code)
  }
  return map
})()

/** The code a route at `path` must be gated on, or `undefined` when the nav gates it on nothing. */
export function navPermissionFor(path: string): string | undefined {
  return NAV_PERMISSIONS.get(path)
}
