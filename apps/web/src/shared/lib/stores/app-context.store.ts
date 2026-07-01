import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { FEATURE_FLAGS, isFeatureEnabled } from '@/shared/config/feature-flags'

export interface WorkspaceContext {
  workspaceId: string
  workspaceSlug: string
  workspaceName: string
}

export interface ProjectContext {
  projectId: string
  projectKey: string
  projectName: string
}

interface AppContextState {
  workspace: WorkspaceContext | null
  project: ProjectContext | null
  team: string | null
  sidebarCollapsed: boolean
  commandPaletteOpen: boolean
  /** Static feature flags for the current deployment. */
  featureFlags: Record<string, boolean>

  setWorkspace: (ws: WorkspaceContext) => void
  setProject: (project: ProjectContext | null) => void
  setTeam: (team: string | null) => void
  toggleSidebar: () => void
  setCommandPalette: (open: boolean) => void
  isFeatureEnabled: (flag: string) => boolean
  reset: () => void
}

export const useAppContext = create<AppContextState>()(
  persist(
    (set) => ({
      workspace: null,
      project: null,
      team: null,
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      featureFlags: FEATURE_FLAGS,

      setWorkspace: (workspace) => set({ workspace }),
      setProject: (project) => set({ project }),
      setTeam: (team) => set({ team }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setCommandPalette: (commandPaletteOpen) => set({ commandPaletteOpen }),
      isFeatureEnabled: (flag) => isFeatureEnabled(flag),
      reset: () => set({ workspace: null, project: null, team: null, sidebarCollapsed: false }),
    }),
    {
      name: 'rally-context',
      partialize: (s) => ({
        workspace: s.workspace,
        project: s.project,
        team: s.team,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    },
  ),
)
