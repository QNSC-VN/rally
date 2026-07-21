import { notify } from '@/shared/lib/toast'

/**
 * useWorkItemFieldCommit — collapses the inline-edit commit handlers that were
 * copy-pasted across StatusRow and ChildTaskRow (each field re-implemented the
 * same `mutation.mutate(patch, { onSuccess: toast.success, onError: toast.error })`
 * boilerplate, plus positive-number validation for the numeric cells).
 *
 * `save(patch, successMsg)` fires the mutation with standard toast feedback.
 * `saveNumber(raw, build, successMsg, label)` validates a numeric field
 * (blank → null, else must be a non-negative number) before saving.
 */
export function useWorkItemFieldCommit<P>(mutation: {
  mutate: (payload: P, options?: { onSuccess?: () => void; onError?: (err: Error) => void }) => void
}) {
  function save(patch: P, successMsg: string) {
    mutation.mutate(patch, {
      onSuccess: () => notify.success(successMsg),
      onError: (err) => notify.error(err.message),
    })
  }

  function saveNumber(
    raw: string,
    build: (value: number | null) => P,
    successMsg: string,
    label: string,
  ) {
    const num = raw.trim() === '' ? null : Number(raw)
    if (num !== null && (Number.isNaN(num) || num < 0)) {
      notify.error(`${label} must be a positive number`)
      return
    }
    save(build(num), successMsg)
  }

  return { save, saveNumber }
}
