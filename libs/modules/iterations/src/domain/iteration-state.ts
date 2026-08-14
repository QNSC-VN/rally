import type { IterationState } from './iteration.types';

/**
 * The iteration State machine — ONE named home for the rule, called by every write that moves
 * `iterations.state` (`PATCH /iterations/:id`, `POST /:id/commit`, `POST /:id/accept`) and by the
 * create path. It used to live inline in `updateIteration` as a two-branch `if`, which is why the
 * three routes could disagree about the same `from → to` pair.
 *
 * The state is MANUAL, and the P2 Iterations SRS (product-docs `origin/main`,
 * `04_Developement_tracking/Phase 2/02_Iterations/SRS.md`) says so four times:
 *
 *   • §1, BA reconciliation 2026-07-24: "User can manually change Iteration State at any time when
 *     permitted."
 *   • §10.1: "Iteration state remains user-editable according to permission." and "No Iteration
 *     state locks scope by itself."
 *   • §10.1: "If an item later moves out of `Accepted`, system should not force a reverse status
 *     change; user manages Iteration status manually." — the SYSTEM must not auto-reverse (that
 *     rule lives in `autoAcceptIterationIfComplete`, which only ever goes
 *     `planning|committed → accepted`); the USER is named as the one who does, so a manual reverse
 *     has to be REACHABLE or the sentence describes nothing.
 *   • §10: "Accepted Iteration does not lock dates, Project/Team, assignment or status by lifecycle
 *     alone. Authorized users can still manually edit fields according to normal permissions."
 *
 * So no `from → to` pair is refused, and this classifier answers WHICH gated action a pair means
 * rather than whether it is allowed. What survives is the CONTENT gate on entering `accepted`
 * (≥1 assigned Story/Defect, every one of them accepted): that is what acceptance means here —
 * §10.1's "Auto-accept requires at least one assigned Story/Defect item; an empty Iteration must
 * not auto-accept" — and it is the one thing `accept` verifies that `commit` and `reopen` do not.
 */
export type IterationStateChange = 'commit' | 'accept' | 'reopen';

/**
 * The states an iteration may be CREATED in.
 *
 * `accepted` is excluded because acceptance is a condition over MEMBERSHIP and a brand-new
 * iteration has no members — so an iteration created `accepted` is exactly the row §10.1's rule can
 * never produce, and nothing would ever correct it (auto-accept only moves
 * `planning|committed → accepted`, never out of it). P2-IT-FR-023: "New Iteration defaults to
 * Planning; authorized user manually changes it to Committed when scope is committed." Committing
 * at birth stays legal — committing early is legal here (see the Phase 6 snapshot notes in
 * CLAUDE.md).
 */
export const CREATABLE_ITERATION_STATES = ['planning', 'committed'] as const;

export type CreatableIterationState = (typeof CREATABLE_ITERATION_STATES)[number];

export function isCreatableIterationState(state: IterationState): state is CreatableIterationState {
  return (CREATABLE_ITERATION_STATES as readonly IterationState[]).includes(state);
}

/**
 * Which gated action a manual `from → to` change is.
 *
 * Total by construction — every pair maps to an action, because the BA refuses none. Callers must
 * exclude the no-op (`from === to`) first: repeating the current state is not a transition, and
 * `applyStateChange` refuses it so a route cannot report a change that did not happen.
 *
 *   planning  → committed : commit  (the manual scope commitment, P2-IT-FR-023)
 *   planning  → accepted  : accept  (content-gated; the auto rule already does exactly this pair)
 *   committed → accepted  : accept  (content-gated)
 *   committed → planning  : reopen  (un-commit; "No Iteration state locks scope by itself")
 *   accepted  → committed : reopen  (the manual reverse §10.1 names)
 *   accepted  → planning  : reopen
 */
export function classifyIterationStateChange(
  from: IterationState,
  to: IterationState,
): IterationStateChange {
  if (to === 'accepted') return 'accept';
  if (from === 'planning' && to === 'committed') return 'commit';
  // Anything else moves BACK down the lifecycle: accepted → committed/planning, or
  // committed → planning.
  return 'reopen';
}
