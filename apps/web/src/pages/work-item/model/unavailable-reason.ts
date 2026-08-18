/**
 * Which of THREE sentences a failed `useWorkItemByKey` earns — GAP-P4-RBAC-003, Fail 3 / AC6.
 *
 * A pure function, in `model/` per FRONTEND_CONVENTIONS §1, so the mapping is assertable without a
 * render and so the page cannot re-derive it from `isError` alone — which is what made all three
 * outcomes look the same, and at worst look like nothing at all (the BA retest opened `/item/US-17`
 * with no access and got a blank page).
 *
 * `GET /v1/work-items/by-key` carries no `@RequirePermission`: item keys are workspace-unique, so the
 * owning project is unknown until the row loads, and the service asserts `work_item:view` on the row's
 * own project afterwards. A refusal is therefore a **403** on this route, not a 404 — and the page is
 * the only place it can be rendered, because the route guard resolves a DIFFERENT project (the
 * selected one) and deliberately renders its children when its own permission read fails.
 *
 *   • `denied`     — 403. The record exists and is not ours. Phase 4 §7's Access Denied.
 *                    THREE server refusals arrive this way and all three are the same sentence to a
 *                    reader: `TEAM_NOT_IN_SCOPE` (another Team's record), `EDITOR_NO_TEAM_SCOPE` (an
 *                    Editor with no Team at all) and — since the BA's 2026-08-17 ruling —
 *                    `PROJECT_BACKLOG_ADMIN_ONLY`, a team-less record, which only a Workspace Admin
 *                    or Project Admin may open. Deliberately NOT split into a fourth reason: §7
 *                    forbids disclosing the restricted record's Project or TEAM, and "this item has
 *                    no Team" is that disclosure. The status is what this function reads, so a new
 *                    403 code needs no change here — which is the property worth keeping.
 *   • `notFound`   — the query SUCCEEDED with `null` (a 404 mapped in the query fn). An answer.
 *   • `loadFailed` — a 500 or a transport fault. Not a claim about the reader or the record.
 *
 * `shared/lib/query/resource.ts` records what collapsing any two of these has already cost.
 */
export type WorkItemUnavailableReason = 'denied' | 'notFound' | 'loadFailed'

export function workItemUnavailableReason(
  isError: boolean,
  error: unknown,
): WorkItemUnavailableReason {
  if (!isError) return 'notFound'
  // `ApiError` carries the HTTP status precisely so this branch can exist — see
  // `workItemByKeyQueryOptions`, which throws it instead of a plain `Error` for that reason. A status
  // we cannot read is a load failure, NEVER a refusal: asserting a denial on no evidence is the same
  // mistake `RequirePermission` avoids by rendering children on `isError`.
  return (error as { status?: number } | undefined)?.status === 403 ? 'denied' : 'loadFailed'
}
