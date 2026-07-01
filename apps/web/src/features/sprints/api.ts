/**
 * Sprints API hooks — TanStack Query wrappers.
 */
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

export type SprintStatus = 'planned' | 'active' | 'completed'

export interface Sprint {
  id: string
  tenantId: string
  projectId: string
  name: string
  goal: string | null
  status: SprintStatus
  startDate: string | null
  endDate: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export function useSprints(projectId: string | undefined) {
  return useQuery({
    queryKey: ['sprints', projectId],
    queryFn: async () => {
      if (!projectId) return []
      const { data, error, response } = await apiClient.GET('/v1/sprints', {
        params: { query: { projectId, limit: 50 } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as { data: Sprint[] }).data ?? []
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })
}

// Active sprints count across all projects
export function useActiveSprintsCount(projects: Array<{ id: string }>) {
  return useQuery({
    queryKey: ['active-sprints-count', [...projects.map((p) => p.id)].sort()],
    queryFn: async () => {
      if (projects.length === 0) return 0
      const allSprints = await Promise.all(
        projects.map(async (project) => {
          const { data } = await apiClient.GET('/v1/sprints', {
            params: { query: { projectId: project.id, limit: 50 } },
          })
          return (data as { data: Sprint[] } | undefined)?.data ?? []
        }),
      )
      return allSprints.flat().filter((s) => s.status === 'active').length
    },
    enabled: projects.length > 0,
    staleTime: 60_000,
  })
}
