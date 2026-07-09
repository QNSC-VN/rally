/**
 * Projects API hooks — TanStack Query wrappers.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

export interface Project {
  id: string
  workspaceId: string
  key: string
  name: string
  description: string | null
  leadId: string | null
  leadName: string | null
  status: 'active' | 'archived'
  memberCount: number
  teamCount: number
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput {
  workspaceId: string
  name: string
  key: string
  description?: string
  leadId?: string
}

export interface UpdateProjectInput {
  name?: string
  description?: string
  leadId?: string | null
  status?: 'active' | 'archived'
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useProjects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return []
      const { data, error, response } = await apiClient.GET('/v1/projects', {
        params: { query: { workspaceId, limit: 100 } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as { data: Project[] }).data ?? []
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateProjectInput) => {
      const { data, error, response } = await apiClient.POST('/v1/projects', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: input as any,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Project
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['projects', vars.workspaceId] })
    },
  })
}

export function useUpdateProject(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateProjectInput }) => {
      const { data, error, response } = await apiClient.PATCH('/v1/projects/{id}', {
        params: { path: { id } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: input as any,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Project
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects', workspaceId] })
    },
  })
}

export function useDeleteProject(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, response } = await apiClient.DELETE('/v1/projects/{id}', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects', workspaceId] })
    },
  })
}

// ── Project Statuses ──────────────────────────────────────────────────────────

export interface ProjectStatus {
  id: string
  projectId: string
  name: string
  category: 'to_do' | 'in_progress' | 'done'
  color: string | null
  position: number
}

export function useProjectStatuses(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-statuses', projectId],
    queryFn: async () => {
      if (!projectId) return []
      const { data, error, response } = await apiClient.GET('/v1/projects/{id}/statuses', {
        params: { path: { id: projectId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as ProjectStatus[]) ?? []
    },
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  })
}

/** Fetches statuses for all given projects and returns a combined id→name map */
export function useStatusMap(projectIds: string[]) {
  return useQuery({
    queryKey: ['status-map', [...projectIds].sort()],
    queryFn: async () => {
      if (projectIds.length === 0) return {} as Record<string, string>
      const allStatuses = await Promise.all(
        projectIds.map(async (projectId) => {
          const { data } = await apiClient.GET('/v1/projects/{id}/statuses', {
            params: { path: { id: projectId } },
          })
          return (data as ProjectStatus[] | undefined) ?? []
        }),
      )
      const map: Record<string, string> = {}
      for (const statuses of allStatuses) {
        for (const s of statuses) {
          map[s.id] = s.name
        }
      }
      return map
    },
    enabled: projectIds.length > 0,
    staleTime: 5 * 60_000,
  })
}
