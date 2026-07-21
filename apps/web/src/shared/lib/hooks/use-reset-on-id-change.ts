import { useState } from 'react'

/**
 * useResetOnIdChange — run `reset` exactly once each time `id` changes.
 *
 * The "sync local form state when the entity first loads / the user switches
 * entity, but NOT on every background refetch" pattern, which was duplicated in
 * WorkspaceSettingsTab and ProjectSettingsTab. Tracking the id (not the object)
 * avoids clobbering an in-progress edit when a refetch returns a new object with
 * the same id.
 *
 * Uses the React "adjust state during render" idiom — `reset` typically calls
 * the component's own setState, so it re-renders immediately with fresh values.
 *
 * Usage:
 *   useResetOnIdChange(current?.id, () => {
 *     setName(current.name)
 *     setDescription(current.description ?? '')
 *   })
 */
export function useResetOnIdChange(id: string | undefined, reset: () => void) {
  const [syncedId, setSyncedId] = useState(id)
  if (id !== undefined && id !== syncedId) {
    setSyncedId(id)
    reset()
  }
}
