import { defaultIterationId } from '@/features/iterations/default-iteration'
import { useState } from 'react'

import { STORAGE_KEYS } from '@/shared/config/storage-keys'

/**
 * Widened from `{ id }` to carry the WINDOW, because the default is now chosen by date rather than by
 * row position — see `defaultIterationId`. Both the reference feed and the record satisfy this.
 */
interface Timebox {
  id: string
  /** State and window, because the default is chosen by both — see `defaultIterationId`. */
  state: string
  startDate: string | null
  endDate: string | null
}

/**
 * The iteration the picker has selected, with the same last-viewed persistence Team Board,
 * Iteration Status and Team Status use.
 *
 * Shared by Iteration Burndown and Team Capacity because the SRS asks for exactly that:
 * "Reuse the Iteration picker behavior from Iteration Burndown". Two independent `useState`s
 * would drift apart the moment one of them gained a default rule.
 *
 * The stored id is validated against the loaded list on every render rather than trusted:
 * an iteration can be deleted, or the user can switch to a project where that id means
 * nothing, and a stale id would make the report look empty rather than fall back.
 */
export function useSelectedIteration(projectId: string | undefined, iterations: Timebox[]) {
  const [chosenId, setChosenId] = useState<string | null>(null)

  const persistedId = projectId
    ? localStorage.getItem(`${STORAGE_KEYS.LAST_ACCESSED_ITERATION}:${projectId}`)
    : null

  const selectedId =
    chosenId && iterations.some((i) => i.id === chosenId)
      ? chosenId
      : persistedId && iterations.some((i) => i.id === persistedId)
        ? persistedId
        : defaultIterationId(iterations)

  function select(id: string) {
    setChosenId(id)
    if (projectId) localStorage.setItem(`${STORAGE_KEYS.LAST_ACCESSED_ITERATION}:${projectId}`, id)
  }

  return { selectedId, select }
}
