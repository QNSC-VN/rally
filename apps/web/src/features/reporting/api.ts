/**
 * Reporting API hooks — TanStack Query wrappers over `/v1/reports`.
 *
 * Read-only: every mutation of the underlying data happens through the work-item, iteration,
 * task and capacity endpoints, and the daily snapshot history is written by a scheduled job
 * with no HTTP surface at all.
 *
 * Scope comes from the global workspace context (`useAppContext`), never from a filter these
 * hooks own — the SRS is explicit that a report must not create a second Project or Team
 * filter. `teamId: undefined` means All Teams.
 */
import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { operations } from '@/shared/api/generated/api'

type Json<T extends keyof operations> = operations[T] extends {
  responses: { 200: { content: { 'application/json': infer R } } }
}
  ? R
  : never

export type IterationBurndown = Json<'ReportingController_getIterationBurndown'>
export type BurndownPoint = IterationBurndown['points'][number]
export type BurndownHistoryState = IterationBurndown['historyState']

export type VelocityReport = Json<'ReportingController_getVelocity'>
export type VelocityBar = VelocityReport['bars'][number]
export type VelocityWindow = VelocityReport['window']

export type TeamCapacityReport = Json<'ReportingController_getTeamCapacity'>
export type TeamCapacityTeam = TeamCapacityReport['teams'][number]
export type TeamCapacityHours = TeamCapacityTeam['totals']

export type ReleaseTrackingReport = Json<'ReportingController_getReleaseTracking'>
export type ReleaseTrackingRow = ReleaseTrackingReport['rows'][number]
export type ReleaseMismatch = ReleaseTrackingRow['mismatches'][number]
export type ReleaseBucket = ReleaseTrackingReport['bucket']
export type ChartUnit = ReleaseTrackingReport['unit']

export type ReleaseBurnup = Json<'ReportingController_getReleaseBurnup'>
export type BurnupPoint = ReleaseBurnup['points'][number]

/** Team is part of every key: switching the global Team selector must refetch, not reuse. */
export const reportingKeys = {
  all: ['reports'] as const,
  burndown: (projectId: string, teamId: string | undefined, iterationId: string) =>
    ['reports', 'iteration-burndown', projectId, teamId ?? 'all', iterationId] as const,
  velocity: (projectId: string, teamId: string | undefined, window: number) =>
    ['reports', 'velocity', projectId, teamId ?? 'all', window] as const,
  teamCapacity: (projectId: string, teamId: string | undefined, iterationId: string) =>
    ['reports', 'team-capacity', projectId, teamId ?? 'all', iterationId] as const,
  releaseTracking: (
    projectId: string,
    teamId: string | undefined,
    releaseId: string,
    unit: ChartUnit,
    bucket: ReleaseBucket,
  ) =>
    ['reports', 'release-tracking', projectId, teamId ?? 'all', releaseId, unit, bucket] as const,
  releaseBurnup: (
    projectId: string,
    teamId: string | undefined,
    releaseId: string,
    unit: ChartUnit,
  ) => ['reports', 'release-burnup', projectId, teamId ?? 'all', releaseId, unit] as const,
}

interface Scope {
  projectId: string | undefined
  teamId?: string | undefined
}

/**
 * Burndown is frozen history: a finalised day cannot change and only today's row moves, so a
 * short staleTime would refetch a series that is identical all day.
 */
const FROZEN = 5 * 60_000
/** Velocity and Team Capacity recalculate from current assignment, so they follow edits. */
const LIVE = 30_000

export function useIterationBurndown({
  projectId,
  teamId,
  iterationId,
}: Scope & { iterationId: string | undefined }) {
  return useQuery({
    queryKey: reportingKeys.burndown(projectId ?? '', teamId, iterationId ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/reports/iteration-burndown', {
        params: { query: { projectId: projectId!, teamId, iterationId: iterationId! } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as IterationBurndown
    },
    enabled: !!projectId && !!iterationId,
    staleTime: FROZEN,
  })
}

export function useVelocity({
  projectId,
  teamId,
  window = 5,
}: Scope & { window?: VelocityWindow }) {
  return useQuery({
    queryKey: reportingKeys.velocity(projectId ?? '', teamId, window),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/reports/velocity', {
        params: { query: { projectId: projectId!, teamId, window } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as VelocityReport
    },
    enabled: !!projectId,
    staleTime: LIVE,
  })
}

export function useTeamCapacityReport({
  projectId,
  teamId,
  iterationId,
}: Scope & { iterationId: string | undefined }) {
  return useQuery({
    queryKey: reportingKeys.teamCapacity(projectId ?? '', teamId, iterationId ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/reports/team-capacity', {
        params: { query: { projectId: projectId!, teamId, iterationId: iterationId! } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as TeamCapacityReport
    },
    enabled: !!projectId && !!iterationId,
    staleTime: LIVE,
  })
}

export function useReleaseTracking({
  projectId,
  teamId,
  releaseId,
  unit,
  bucket,
}: Scope & { releaseId: string | undefined; unit: ChartUnit; bucket: ReleaseBucket }) {
  return useQuery({
    queryKey: reportingKeys.releaseTracking(projectId ?? '', teamId, releaseId ?? '', unit, bucket),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/reports/release-tracking', {
        params: { query: { projectId: projectId!, teamId, releaseId: releaseId!, unit, bucket } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as ReleaseTrackingReport
    },
    enabled: !!projectId && !!releaseId,
    staleTime: LIVE,
  })
}

export function useReleaseBurnup({
  projectId,
  teamId,
  releaseId,
  unit,
}: Scope & { releaseId: string | undefined; unit: ChartUnit }) {
  return useQuery({
    queryKey: reportingKeys.releaseBurnup(projectId ?? '', teamId, releaseId ?? '', unit),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/reports/release-tracking/burnup', {
        params: { query: { projectId: projectId!, teamId, releaseId: releaseId!, unit } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as ReleaseBurnup
    },
    enabled: !!projectId && !!releaseId,
    // Burnup days are finalised like burndown days: only today's point can still move.
    staleTime: FROZEN,
  })
}
