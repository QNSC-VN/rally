import { useFieldCommit } from '@/shared/lib/hooks/use-field-commit'

/**
 * Thin façade over the shared {@link useFieldCommit}.
 *
 * The implementation moved to `shared/lib/hooks` once a second grid (Portfolio's Refined
 * Estimate) needed the same numeric guard — a page folder is the wrong home for something
 * two pages depend on. This re-export keeps every existing call site in this page valid;
 * new call sites should import the shared hook directly.
 *
 * The one seam: the shared `saveNumber` takes the FULL message to show, so a caller can
 * pass a translated string. This wrapper keeps the label-shaped argument the call sites
 * here already pass, and builds the same English sentence they were already showing.
 */
export function useWorkItemFieldCommit<P>(mutation: {
  mutate: (payload: P, options?: { onSuccess?: () => void; onError?: (err: Error) => void }) => void
}) {
  const { save, saveNumber } = useFieldCommit(mutation)
  return {
    save,
    saveNumber: (
      raw: string,
      build: (value: number | null) => P,
      successMsg: string,
      label: string,
    ) => saveNumber(raw, build, successMsg, `${label} must be a positive number`),
  }
}
