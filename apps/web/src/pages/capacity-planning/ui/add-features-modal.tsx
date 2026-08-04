import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { EMPTY_VALUE } from '@/shared/lib/utils'
import { SelectionModal } from '@/shared/ui/selection-modal'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { PortfolioItemType } from '@/entities/work-item/model/types'
import { usePortfolioItems } from '@/features/portfolio/api'
import { useAllocate, type CapacityPlan } from '@/features/capacity-planning/api'

/**
 * Rally's `Add Items`: a checkbox list of the portfolio items eligible for this plan, confirmed with
 * `Add to Plan`.
 *
 * Rally separates two acts that we had merged into one dialog — putting Features ON the plan, and
 * allocating them TO teams. This is the first: the rows land unassigned (or on one team, when opened
 * from that team's list), and assignment happens afterwards in the grid. Merging them made a
 * multi-Feature add into one dialog per Feature, and made "add" and "allocate" the same word.
 *
 * Reuses the shared `SelectionModal` — the same searchable checkbox list milestones use for their
 * projects and the plan uses for its teams. Search covers what Rally's in-dialog `Show Filters`
 * does for a long portfolio list; the picker shows key + name only, so there is nothing for a
 * `Show Fields` to reveal.
 *
 * Features ALREADY on the plan are absent from the list rather than shown ticked: ticking them off
 * would read as a way to remove them, and removal is the item menu's `Remove From Plan` — a
 * different decision with a different confirmation.
 */
export function AddFeaturesModal({
  plan,
  teamId = null,
  teamName,
  onClose,
}: {
  plan: CapacityPlan
  /** Adds straight to this team — Rally's `Add Items to Project Plan`. Null leaves rows unassigned. */
  teamId?: string | null
  /** Names the team in the title, so the two entry points cannot be confused mid-dialog. */
  teamName?: string | null
  onClose: () => void
}) {
  const { t } = useTranslation('capacity')
  const allocate = useAllocate()

  // Features in the plan's own project; the API enforces the same scope on every write.
  const { items: features } = usePortfolioItems({
    type: PortfolioItemType.Feature,
    projectId: plan.projectId,
  })

  /** Features already allocated to THIS team — §247's `Added` rows. */
  const inThisTeam = useMemo(
    () =>
      new Set(plan.allocations.filter((a) => a.teamId === teamId).map((a) => a.portfolioItemId)),
    [plan.allocations, teamId],
  )

  /** Every Feature already on the plan in any form — what the PLAN-level picker excludes. */
  const onPlan = useMemo(
    () => new Set(plan.allocations.map((a) => a.portfolioItemId)),
    [plan.allocations],
  )

  /** Team name per id, for the ownership line below. `plan.teams` is the only source that has names. */
  const teamNameById = useMemo(
    () => new Map(plan.teams.map((pt) => [pt.teamId, pt.teamName ?? EMPTY_VALUE])),
    [plan.teams],
  )

  /**
   * RALLY PARITY (differs from BA design — the design here was OURS, and it was thin)
   * Rally: the `Add Items` dialog carries Planned Project Assignment, Project and the numerics
   * alongside ID and Name, and Capacity SRS §225-233 asks for the same — Team and Allocation — "so
   * the planner can see which Team currently owns each Feature".
   * This file's own docblock previously argued "the picker shows key + name only, so there is nothing
   * for a `Show Fields` to reveal". That was true of the implementation, not of the requirement.
   * Decided 2026-08-04. See 09_Gap_Audit/PHASE_5_6_DECISION_MATRIX.md#P5-CP-5
   *
   * Project is deliberately NOT shown: this picker already fetches only the plan's own project, so
   * the column would repeat one value on every row.
   *
   * Reads the allocations on THIS plan rather than the Feature's own team, because that is the
   * number the decision turns on — a Feature can sit on several teams here, and the planner is about
   * to add one more.
   */
  const ownershipMeta = useCallback(
    (portfolioItemId: string): string | undefined => {
      const rows = plan.allocations.filter((a) => a.portfolioItemId === portfolioItemId)
      // Unallocated is the common case in the plan-level picker and needs no annotation: an empty
      // trailing slot reads as "not yet placed", where the word would read as a status.
      if (rows.length === 0) return undefined

      const parked = rows.filter((a) => a.teamId === null)
      const assigned = rows.filter((a) => a.teamId !== null)
      const total = rows.reduce((sum, a) => sum + Number(a.value), 0)

      const who =
        assigned.length > 0
          ? assigned.map((a) => teamNameById.get(a.teamId as string) ?? EMPTY_VALUE).join(', ')
          : t('addFeatures.unassigned')
      // A parked row alongside assigned ones is a real state (AC-005 re-parks demand on team removal),
      // so say both rather than picking one and understating the plan's committed total.
      const suffix =
        parked.length > 0 && assigned.length > 0 ? ` + ${t('addFeatures.unassigned')}` : ''

      // Bare number, no unit suffix: the plan's unit renames the COLUMN HEADERS on this screen
      // (Points/Count Rollup, …) and every value is rendered unitless, so appending one here would
      // make this the only place that says "pts".
      const amount = Number.isInteger(total) ? String(total) : total.toFixed(2)
      return `${who}${suffix} · ${amount}`
    },
    [plan.allocations, t, teamNameById],
  )

  const items = useMemo(
    () =>
      features
        /**
         * Not archived, not cancelled — both pickers, and both enforced by the API too. A picker is a
         * courtesy, not a rule, but offering a Feature that will be refused turns a click into a toast.
         */
        .filter((f) => f.archivedAt === null && f.state !== 'cancelled')
        /**
         * The two pickers have DIFFERENT scopes, and §225-233 is explicit about why.
         *
         * Team-level `Add Features` applies **no Release filter**: "a Feature on any Release, or none,
         * may be pulled into a Team, because a planner needs to see the Project's whole Feature
         * inventory when staffing a Team". The plan-level `Add Feature` keeps the eligibility list,
         * Release included, and offers only Features not yet on the plan.
         *
         * This filtered by release on BOTH paths, so the team picker could not do the one thing §226
         * describes — and the API refused those allocations anyway, which is why that guard now keys
         * off whether a team is named.
         */
        .filter((f) => teamId !== null || f.releaseId === null || f.releaseId === plan.releaseId)
        /**
         * §247: a Feature already in the SELECTED TEAM stays visible, "marked as added, with selection
         * disabled … deliberately not removed from the list, so the planner can see what is already in
         * the Team". Only the plan-level picker drops rows, because "not yet in this Plan" is its
         * documented scope.
         */
        .filter((f) => teamId !== null || !onPlan.has(f.id))
        .map((f) => ({
          id: f.id,
          name: `${f.itemKey} — ${f.name}`,
          icon: <TypeBadge type="feature" size={16} />,
          disabled: teamId !== null && inThisTeam.has(f.id),
          disabledNote: t('addFeatures.added'),
          meta: ownershipMeta(f.id),
        })),
    [features, inThisTeam, onPlan, ownershipMeta, plan.releaseId, t, teamId],
  )

  /**
   * One allocation per ticked Feature, in sequence.
   *
   * Sequential rather than parallel: each write returns the whole plan, and firing them together
   * would race four refetches to decide which snapshot the cache keeps.
   */
  async function add(ids: string[]) {
    for (const portfolioItemId of ids) {
      /**
       * The value the two pickers default to is DIFFERENT, and the BA states both.
       *
       * §246, Team-level `Add Features`: "create one allocation row for the selected Team with default
       * allocation value `0`" — the planner is staffing a team and will size the work afterwards. But
       * "If the Feature already has an Unallocated row, move that existing row to the selected Team and
       * keep its current allocation value", so a 0 must NOT be sent when one exists: omitting the value
       * is what tells the API to preserve it.
       *
       * The plan-level picker creates an unassigned row, where §185's blank-Estimate rule applies —
       * omit the value and the Feature's own estimate is copied in. That number then survives the row
       * later being assigned to a team, which is the same §244 rule seen from the other end.
       */
      const parked = plan.allocations.some(
        (a) => a.portfolioItemId === portfolioItemId && a.teamId === null,
      )
      await allocate.mutateAsync({
        id: plan.id,
        portfolioItemId,
        teamId,
        ...(teamId !== null && !parked ? { value: 0 } : {}),
      })
    }
  }

  return (
    <SelectionModal
      open
      onClose={onClose}
      title={
        teamName == null
          ? t('addFeatures.title')
          : t('addFeatures.titleForTeam', { team: teamName })
      }
      items={items}
      // Nothing is pre-ticked: this dialog only ever ADDS, so a tick means "put this on the plan".
      selectedIds={[]}
      onSave={add}
      confirmLabel={t('addFeatures.confirm')}
      searchPlaceholder={t('addFeatures.searchPlaceholder')}
    />
  )
}
