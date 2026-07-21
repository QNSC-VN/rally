import { type Project } from '@/features/projects/api'

export type ProjectColKey =
  'key' | 'name' | 'status' | 'owner' | 'teams' | 'members' | 'startDate' | 'updated' | 'actions'

/** Per-render context handed to each column cell (lookups + row callbacks). */
export interface ProjectCtx {
  currentUserId?: string
  currentUserName?: string
  openMenu: string | null
  setOpenMenu: (id: string | null) => void
  onEdit: (project: Project) => void
  onToggleArchive: (project: Project) => void
}
