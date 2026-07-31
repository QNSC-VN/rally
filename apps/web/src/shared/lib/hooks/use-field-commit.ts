import { notify } from '@/shared/lib/toast'

/**
 * `useFieldCommit` — the inline-edit commit boilerplate for a grid cell, in one place.
 *
 * Every editable cell needs the same three things: fire the mutation, toast on success,
 * toast the error otherwise. Numeric cells need a fourth: reject a non-number BEFORE
 * sending it, or a stray keystroke becomes `NaN` in a PATCH body.
 *
 * Was `useWorkItemFieldCommit` under `pages/iteration-status`, which meant the second
 * grid to need it (Portfolio's Refined Estimate) had to either reach across into another
 * page's folder or hand-roll the same validator again. It depends on nothing but
 * `notify`, so it belongs here.
 *
 * @typeParam P - the mutation's payload type, so `build` stays type-checked per call site.
 */
export function useFieldCommit<P>(mutation: {
  mutate: (payload: P, options?: { onSuccess?: () => void; onError?: (err: Error) => void }) => void
}) {
  function save(patch: P, successMsg: string) {
    mutation.mutate(patch, {
      onSuccess: () => notify.success(successMsg),
      onError: (err) => notify.error(err.message),
    })
  }

  /**
   * Commit a numeric cell.
   *
   * Blank CLEARS the field (`null`) rather than writing 0. That distinction is the
   * repo-wide rule for human-entered numbers, not a preference: the schema keeps every
   * typed estimate nullable-with-no-default precisely so "not entered" and "zero" stay
   * different claims (`db/schema/work.ts` — "Null = capacity not yet entered, which is
   * different from zero capacity"). Non-numeric and negative are refused with
   * `invalidMsg` rather than sent as `NaN`.
   *
   * 0 is ACCEPTED: for an hour count it is a real value. A field where 0 is illegal rather
   * than merely unusual — a forecast whose DB CHECK is `IS NULL OR > 0` — is guarded
   * server-side, which is the right place for a database constraint.
   */
  function saveNumber(
    raw: string,
    build: (value: number | null) => P,
    successMsg: string,
    invalidMsg: string,
  ) {
    const num = raw.trim() === '' ? null : Number(raw)
    if (num !== null && (!Number.isFinite(num) || num < 0)) {
      notify.error(invalidMsg)
      return
    }
    save(build(num), successMsg)
  }

  return { save, saveNumber }
}
