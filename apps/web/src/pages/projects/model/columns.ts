import type { UpdateProjectInput } from '@/features/projects/api'
import type { OwnerSelectMember } from '@/shared/ui/owner-cell'

export type ProjectColKey =
  | 'key'
  | 'name'
  | 'status'
  | 'owner'
  | 'teams'
  | 'members'
  | 'startDate'
  | 'endDate'
  | 'updated'

/**
 * Per-render context for the Projects grid cells. Only the Key column links to
 * the detail page; every other editable column edits inline (like Iteration
 * Status) via `onPatch`, so the row carries the mutation wiring + lookups.
 */
export interface ProjectCtx {
  currentUserId?: string
  currentUserName?: string
  /** Owner (Project lead) options for the inline owner dropdown. */
  members: OwnerSelectMember[]
  /** Inline commit — one shared project mutation for the whole list. */
  onPatch: (id: string, input: UpdateProjectInput) => void
  /** Open the detail page (Key link). */
  onOpen: (projectKey: string) => void
}
