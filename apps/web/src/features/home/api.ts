/**
 * Home dashboard data — bounded, server-side aggregate endpoints that replace
 * the old per-project fan-out (which fired ~300 requests and computed totals
 * from capped page fetches). Each widget now makes ONE request:
 *   - useWorkspaceSummary → GET /v1/work-items/summary   (exact workspace counts)
 *   - useMyWork(limit)    → GET /v1/work-items/my         (top-N assigned)
 *   - useProjectHealth(n) → GET /v1/projects/health       (bounded rollup)
 */
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

export interface WorkspaceSummary {
  activeProjects: number
  openWorkItems: number
  activeSprints: number
  blockedItems: number
  openDefects: number
  assignedToMe: number
}

export interface MyWorkItem {
  id: string
  itemKey: string
  type: string
  title: string
  scheduleState: string
  priority: string
  projectId: string
  projectKey: string
  projectName: string
}

export interface ProjectHealth {
  id: string
  key: string
  name: string
  leadId: string | null
  leadName: string | null
  activeSprintName: string | null
  progressPercent: number
  openDefects: number
  blockedCount: number
}

export function useWorkspaceSummary(enabled = true) {
  return useQuery({
    queryKey: ['home', 'summary'],
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/work-items/summary', {})
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as WorkspaceSummary
    },
    enabled,
    staleTime: 30_000,
  })
}

export function useMyWork(limit = 10, enabled = true) {
  return useQuery({
    queryKey: ['home', 'my-work', limit],
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/work-items/my', {
        params: { query: { limit: String(limit) } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as MyWorkItem[]) ?? []
    },
    enabled,
    staleTime: 30_000,
  })
}

export function useProjectHealth(limit = 10, enabled = true) {
  return useQuery({
    queryKey: ['home', 'project-health', limit],
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/projects/health', {
        params: { query: { limit: String(limit) } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as ProjectHealth[]) ?? []
    },
    enabled,
    staleTime: 30_000,
  })
}
