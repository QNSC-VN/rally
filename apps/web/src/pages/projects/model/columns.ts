export type ProjectColKey =
  'key' | 'name' | 'status' | 'owner' | 'teams' | 'members' | 'startDate' | 'updated'

/** Per-render context handed to each column cell (owner-name lookups). */
export interface ProjectCtx {
  currentUserId?: string
  currentUserName?: string
}
