/**
 * Reporting API hooks — TanStack Query wrappers over the `reporting` module
 * (`/v1/reports`). These are read-only analytics read-models; all mutation of
 * the underlying data happens through the work-item / iteration endpoints.
 */
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components, operations } from '@/shared/api/generated/api'

export type SprintBurndown =
  operations['ReportingController_getBurndown']['responses']['200']['content']['application/json']
export type BurndownPoint = NonNullable<SprintBurndown['points']>[number]

export type ProjectVelocity =
  operations['ReportingController_getVelocity']['responses']['200']['content']['application/json']
export type VelocitySprint = NonNullable<ProjectVelocity['sprints']>[number]

// Re-export so pages don't reach into the generated client for the iteration
// metric read-model they blend into the report strip.
export type IterationStatus = components['schemas']['IterationStatusResponseDto']

export const reportingKeys = {
  all: ['reports'] as const,
  burndown: (sprintId: string) => ['reports', 'burndown', sprintId] as const,
  velocity: (projectId: string, lastNSprints: number) =>
    ['reports', 'velocity', projectId, lastNSprints] as const,
}

/** Sprint (iteration) burndown — remaining vs completed points/items per day. */
export function useSprintBurndown(sprintId: string | undefined) {
  return useQuery({
    queryKey: reportingKeys.burndown(sprintId ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET(
        '/v1/reports/sprints/{sprintId}/burndown',
        {
          params: { path: { sprintId: sprintId! } },
        },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as SprintBurndown
    },
    enabled: !!sprintId,
    staleTime: 30_000,
  })
}

/** Sprint velocity across the last N iterations for a project. */
export function useProjectVelocity(projectId: string | undefined, lastNSprints = 6) {
  return useQuery({
    queryKey: reportingKeys.velocity(projectId ?? '', lastNSprints),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET(
        '/v1/reports/projects/{projectId}/velocity',
        {
          params: { path: { projectId: projectId! }, query: { lastNSprints } },
        },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as ProjectVelocity
    },
    enabled: !!projectId,
    staleTime: 60_000,
  })
}
