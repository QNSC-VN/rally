/**
 * The Owner a create form starts on: the signed-in user when the picker already offers them,
 * `Unassigned` otherwise.
 *
 * THE RULE
 * --------
 * `WIC-FR-006` (BA `c42df59`, 2026-08-22): "Owner defaults to the authenticated current user only
 * when that user is eligible in the selected Project/Team. Otherwise it defaults to `Unassigned`.
 * User can always explicitly choose `Unassigned`/`No Entry`." Rally agrees — its Owner "defaults to
 * the user who creates the defect but can be changed at any time".
 *
 * This REVERSES `GAP-P1-WID-007` / `P6-TC-007`'s older "default to Unassigned", and the reversal is
 * narrower than the rule it replaces. The original defect seeded the creator's id UNCONDITIONALLY,
 * so an item created by someone with no business owning it arrived owned by them and a Task under it
 * inherited that — `P6-TC-007`'s "null-owner Task attributed to a named member", and the upstream
 * cause of `GAP-P3-TS-008`'s off-roster member group in Team Status. **The gate is the whole safety
 * property**: the creator is offered only when the shared assignment feed already offers them, so
 * this can never name someone the picker itself would refuse to show.
 *
 * WHY IT IS A HOOK AND NOT FOUR COPIES
 * ------------------------------------
 * `create-work-item-modal.tsx` implemented it inline and its own docblock called the expression
 * `eligibleDefaultOwner` — a name for something that did not exist, because the logic was three
 * lines of ternary at one call site. `create-portfolio-item-modal.tsx` then wrote its own, subtly
 * different version (no `touched` tracking, so an explicit `Unassigned` was silently re-defaulted on
 * the next render), and two more create surfaces still defaulted to nothing at all. Four surfaces
 * asking one question is exactly the drift a shared rule prevents.
 *
 * TWO PROPERTIES THAT ARE EASY TO GET WRONG, both encoded here:
 *
 *  - **DERIVED, never stored.** Writing the default into state from an effect cascades a render (the
 *    linter says so) and has to re-run on every Team change to stay correct. The value is recomputed
 *    from the feed instead, so it follows eligibility for free.
 *  - **An explicit choice wins forever, `Unassigned` included.** Without a `touched` flag, a reader
 *    who clears the Owner has it handed straight back on the next render — the feed still offers
 *    them, so the default still applies. `Unassigned` is a choice the BA names explicitly, so it has
 *    to survive being made.
 */
import { useCallback, useState } from 'react'

import { useAuthStore } from '@/shared/lib/stores/auth.store'

/** The minimum a candidate row needs for this decision — the same shape every owner feed returns. */
export interface OwnerCandidate {
  userId: string
}

export interface DefaultOwnerState {
  /** The id to render as selected: the reader's choice once made, else the eligible default. */
  ownerId: string
  /** Pass to the picker's `onChange`. Records the choice, so the default never returns. */
  setOwnerId: (userId: string) => void
  /**
   * Forget the reader's choice and fall back to the default again.
   *
   * DISTINCT FROM `setOwnerId('')`, and the distinction is a reported bug. A Team change has to drop
   * an owner belonging to the previous team — their row is no longer offered, and a draft must not
   * submit a value its own picker would not show. Spelling that as `setOwnerId('')` records an
   * explicit `Unassigned`, which is exactly the state the reader is allowed to hold forever, so the
   * default was suppressed for the rest of the form's life: pick a Team containing you, and Owner
   * stayed `— No Entry —` (reported 2026-08-23).
   *
   * "Clear what was chosen" and "choose nobody" are different intents. Only the second is the
   * reader's.
   */
  resetOwner: () => void
  /** Whether the reader has chosen — exposed for callers that must not submit an untouched form. */
  touched: boolean
}

/**
 * @param candidates The options the picker is rendering. The default is gated on membership of
 *   THIS list, so a caller must pass the same feed it offers — passing a wider one reintroduces the
 *   unconditional seeding this rule exists to prevent.
 */
export function useDefaultOwner(candidates: OwnerCandidate[]): DefaultOwnerState {
  const currentUserId = useAuthStore((s) => s.user?.id)
  const [chosen, setChosen] = useState<string | null>(null)

  const eligibleDefault =
    currentUserId && candidates.some((c) => c.userId === currentUserId) ? currentUserId : ''

  const setOwnerId = useCallback((userId: string) => setChosen(userId), [])
  const resetOwner = useCallback(() => setChosen(null), [])

  return {
    ownerId: chosen ?? eligibleDefault,
    setOwnerId,
    resetOwner,
    touched: chosen !== null,
  }
}
