/**
 * Capacity planning API — one plan per (project, release).
 *
 * Every read returns the WHOLE plan (teams and totals included), so there is one query
 * key per plan rather than a key per sub-collection. The grid shows team rows alongside
 * plan totals; splitting them would mean the two halves could disagree mid-refetch, and
 * the server already assembles them in a single response for that reason.
 *
 * Not to be confused with Team Status capacity (`features/team-status`), which is
 * per-member HOURS inside one iteration. This is per-TEAM capacity across a release, in
 * the plan's own unit.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components, paths } from '@/shared/api/generated/api'

// ── Types ────────────────────────────────────────────────────────────────────

export type CapacityPlan = components['schemas']['CapacityPlanResponseDto']
export type CapacityPlanTeam = CapacityPlan['teams'][number]
export type CapacityPlanUnit = CapacityPlan['unit']
export type CapacityPlanStatus = CapacityPlan['status']

export type CapacityForecast = components['schemas']['CapacityForecastResponseDto']
export type CapacityForecastComplexity =
  paths['/v1/capacity-plans/{id}/teams/{teamId}/forecast']['post']['requestBody']['content']['application/json']['complexity']

export type CreateCapacityPlanBody =
  paths['/v1/capacity-plans']['post']['requestBody']['content']['application/json']
export type UpdateCapacityPlanBody =
  paths['/v1/capacity-plans/{id}']['patch']['requestBody']['content']['application/json']

// ── Keys ─────────────────────────────────────────────────────────────────────

/**
 * Rooted at `['capacity-plans']` / `['capacity-plan']`, both of which
 * `CAPACITY_ROOTS` in `shared/api/invalidation.ts` lists. That is what makes a release
 * rename, a team rename or (from the next slice) a portfolio write refresh these views.
 */
export const capacityKeys = {
  all: ['capacity-plans'] as const,
  list: (projectId: string) => ['capacity-plans', projectId] as const,
  detail: (id: string) => ['capacity-plan', id] as const,
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useCapacityPlans(projectId: string | undefined) {
  return useQuery({
    queryKey: capacityKeys.list(projectId ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/capacity-plans', {
        params: { query: { projectId: projectId as string } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as CapacityPlan[] | undefined) ?? []
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })
}

export function useCapacityPlan(id: string | undefined) {
  return useQuery({
    queryKey: capacityKeys.detail(id ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/capacity-plans/{id}', {
        params: { path: { id: id as string } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as CapacityPlan
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateCapacityPlan() {
  return useMutation({
    mutationFn: async (body: CreateCapacityPlanBody) => {
      const { data, error, response } = await apiClient.POST('/v1/capacity-plans', { body })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as CapacityPlan
    },
    meta: { invalidates: ['capacity'] },
  })
}

export function useUpdateCapacityPlan() {
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: UpdateCapacityPlanBody }) => {
      const { data, error, response } = await apiClient.PATCH('/v1/capacity-plans/{id}', {
        params: { path: { id } },
        body: patch,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as CapacityPlan
    },
    meta: { invalidates: ['capacity'] },
  })
}

export function useAddCapacityTeam() {
  return useMutation({
    mutationFn: async ({ id, teamId }: { id: string; teamId: string }) => {
      const { data, error, response } = await apiClient.POST('/v1/capacity-plans/{id}/teams', {
        params: { path: { id } },
        body: { teamId },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as CapacityPlan
    },
    meta: { invalidates: ['capacity'] },
  })
}

/**
 * Set or CLEAR a team's capacity.
 *
 * `capacity: null` clears it back to "not entered", which the grid renders blank. Passing
 * 0 instead would assert a real ceiling of zero and make the team look fully committed, so
 * the two must stay distinguishable all the way to the wire.
 */
export function useSetCapacity() {
  return useMutation({
    mutationFn: async ({
      id,
      teamId,
      capacity,
    }: {
      id: string
      teamId: string
      capacity: number | null
    }) => {
      const { data, error, response } = await apiClient.PATCH(
        '/v1/capacity-plans/{id}/teams/{teamId}',
        { params: { path: { id, teamId } }, body: { capacity } },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as CapacityPlan
    },
    meta: { invalidates: ['capacity'] },
  })
}

/**
 * Rally's Calculate Capacity Forecast, for one team.
 *
 * A MUTATION hook for a read-only call, because the request carries a body (availability and
 * complexity) and the route is a POST. Deliberately declares NO `invalidates`: it computes a
 * number and writes nothing, so invalidating the plan would refetch the grid for no reason
 * and discard a forecast the planner is still looking at.
 *
 * Committing the number is a separate act — `useSetCapacity` — which is what carries the
 * cache invalidation and the `capacity:manage` permission.
 */
export function useForecastCapacity() {
  return useMutation({
    mutationFn: async ({
      id,
      teamId,
      availabilityPct,
      complexity,
    }: {
      id: string
      teamId: string
      availabilityPct: number
      complexity: CapacityForecastComplexity
    }) => {
      const { data, error, response } = await apiClient.POST(
        '/v1/capacity-plans/{id}/teams/{teamId}/forecast',
        { params: { path: { id, teamId } }, body: { availabilityPct, complexity } },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as CapacityForecast
    },
  })
}

export function useRemoveCapacityTeam() {
  return useMutation({
    mutationFn: async ({ id, teamId }: { id: string; teamId: string }) => {
      const { data, error, response } = await apiClient.DELETE(
        '/v1/capacity-plans/{id}/teams/{teamId}',
        { params: { path: { id, teamId } } },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as CapacityPlan
    },
    meta: { invalidates: ['capacity'] },
  })
}

// ── Allocations ──────────────────────────────────────────────────────────────

export type CapacityAllocation = CapacityPlan['allocations'][number]
export type EstimateTier = CapacityAllocation['tier']
export type CapacityMetrics = CapacityAllocation['metrics']
export type CapacityWarning = CapacityMetrics['warnings'][number]

export type AllocateBody =
  paths['/v1/capacity-plans/{id}/allocations']['post']['requestBody']['content']['application/json']

/**
 * Commit demand for a Feature.
 *
 * Omitting `value` accepts the server's default, which is Refined → Preliminary and
 * deliberately SKIPS the allocated tier — a blank field must not commit the sum of the
 * allocations it is being used to create.
 */
export function useAllocate() {
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & AllocateBody) => {
      const { data, error, response } = await apiClient.POST(
        '/v1/capacity-plans/{id}/allocations',
        { params: { path: { id } }, body },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as CapacityPlan
    },
    meta: { invalidates: ['capacity'] },
  })
}

export function useUpdateAllocation() {
  return useMutation({
    mutationFn: async ({
      id,
      allocationId,
      ...body
    }: {
      id: string
      allocationId: string
      value?: number
      teamId?: string | null
    }) => {
      const { data, error, response } = await apiClient.PATCH(
        '/v1/capacity-plans/{id}/allocations/{allocationId}',
        { params: { path: { id, allocationId } }, body },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as CapacityPlan
    },
    meta: { invalidates: ['capacity'] },
  })
}

export function useRemoveAllocation() {
  return useMutation({
    mutationFn: async ({ id, allocationId }: { id: string; allocationId: string }) => {
      const { data, error, response } = await apiClient.DELETE(
        '/v1/capacity-plans/{id}/allocations/{allocationId}',
        { params: { path: { id, allocationId } } },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as CapacityPlan
    },
    meta: { invalidates: ['capacity'] },
  })
}
