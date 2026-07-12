/**
 * Milestones API hooks — TanStack Query wrappers.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

export type MilestoneStatus = 'planned' | 'at_risk' | 'met' | 'missed' | 'cancelled' | 'completed'

export interface MilestoneProgress {
  totalItems: number
  completedItems: number
  totalPoints: number
  completedPoints: number
  progressPercent: number
}

export interface Milestone {
  id: string
  tenantId: string
  projectId: string
  name: string
  description: string | null
  notes: string | null
  status: MilestoneStatus
  ownerId: string | null
  targetStartDate: string | null
  targetEndDate: string | null
  releaseIds: string[]
  progress?: MilestoneProgress
  createdAt: string
  updatedAt: string
}

export const milestoneKeys = {
  all: ['milestones'] as const,
  list: (projectId: string) => [...milestoneKeys.all, 'list', projectId] as const,
  detail: (id: string) => [...milestoneKeys.all, 'detail', id] as const,
} as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = apiClient as any

export function useMilestones(projectId: string | undefined) {
  return useQuery({
    queryKey: milestoneKeys.list(projectId ?? ''),
    queryFn: async () => {
      if (!projectId) return []
      const { data, error, response } = await client.GET('/v1/milestones', {
        params: { query: { projectId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return ((data as { data?: Milestone[] } | undefined)?.data ?? []) as Milestone[]
    },
    enabled: !!projectId,
    staleTime: 60_000,
  })
}

export function useMilestone(id: string | undefined) {
  return useQuery({
    queryKey: milestoneKeys.detail(id ?? ''),
    queryFn: async () => {
      if (!id) return null
      const { data, error, response } = await client.GET('/v1/milestones/{id}', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as unknown as Milestone
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

export interface CreateMilestoneInput {
  projectId: string
  name: string
  description?: string
  notes?: string
  status?: MilestoneStatus
  ownerId?: string
  targetStartDate?: string
  targetEndDate?: string
  releaseIds?: string[]
}

export function useCreateMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateMilestoneInput) => {
      const { data, error, response } = await client.POST('/v1/milestones', {
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as unknown as Milestone
    },
    onSuccess: (milestone: Milestone) => {
      void qc.invalidateQueries({ queryKey: milestoneKeys.list(milestone.projectId) })
    },
  })
}

export interface UpdateMilestoneInput {
  name?: string
  description?: string | null
  notes?: string | null
  status?: MilestoneStatus
  ownerId?: string | null
  targetStartDate?: string | null
  targetEndDate?: string | null
  releaseIds?: string[]
}

export function useUpdateMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateMilestoneInput & { id: string }) => {
      const { data, error, response } = await client.PATCH('/v1/milestones/{id}', {
        params: { path: { id } },
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as unknown as Milestone
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: milestoneKeys.all })
    },
  })
}

export function useDeleteMilestone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, response } = await client.DELETE('/v1/milestones/{id}', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: milestoneKeys.all })
    },
  })
}

// ── Milestone relations: Projects, Teams, Artifacts ─────────────────────────────

export function useMilestoneProjects(milestoneId: string | undefined) {
  return useQuery({
    queryKey: ['milestone', milestoneId, 'projects'],
    queryFn: async () => {
      if (!milestoneId) return []
      const { data, error, response } = await client.GET('/v1/milestones/{id}/projects', {
        params: { path: { id: milestoneId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return ((data as { data?: { id: string; name: string }[] } | undefined)?.data ?? [])
    },
    enabled: !!milestoneId,
    staleTime: 30_000,
  })
}

export function useSetMilestoneProjects() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ milestoneId, projectIds }: { milestoneId: string; projectIds: string[] }) => {
      const { data, error, response } = await client.PUT('/v1/milestones/{id}/projects', {
        params: { path: { id: milestoneId } },
        body: { projectIds } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['milestone', vars.milestoneId, 'projects'] })
      void qc.invalidateQueries({ queryKey: milestoneKeys.detail(vars.milestoneId) })
    },
  })
}

export function useMilestoneTeams(milestoneId: string | undefined) {
  return useQuery({
    queryKey: ['milestone', milestoneId, 'teams'],
    queryFn: async () => {
      if (!milestoneId) return []
      const { data, error, response } = await client.GET('/v1/milestones/{id}/teams', {
        params: { path: { id: milestoneId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return ((data as { data?: { id: string; name: string }[] } | undefined)?.data ?? [])
    },
    enabled: !!milestoneId,
    staleTime: 30_000,
  })
}

export function useSetMilestoneTeams() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ milestoneId, teamIds }: { milestoneId: string; teamIds: string[] }) => {
      const { data, error, response } = await client.PUT('/v1/milestones/{id}/teams', {
        params: { path: { id: milestoneId } },
        body: { teamIds } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['milestone', vars.milestoneId, 'teams'] })
      void qc.invalidateQueries({ queryKey: milestoneKeys.detail(vars.milestoneId) })
    },
  })
}

export function useMilestoneReleases(milestoneId: string | undefined) {
  return useQuery({
    queryKey: ['milestone', milestoneId, 'releases'],
    queryFn: async () => {
      if (!milestoneId) return []
      const { data, error, response } = await client.GET('/v1/milestones/{id}/releases', {
        params: { path: { id: milestoneId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return ((data as { data?: { id: string; name: string }[] } | undefined)?.data ?? [])
    },
    enabled: !!milestoneId,
    staleTime: 30_000,
  })
}

export function useSetMilestoneReleases() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ milestoneId, releaseIds }: { milestoneId: string; releaseIds: string[] }) => {
      const { data, error, response } = await client.PUT('/v1/milestones/{id}/releases', {
        params: { path: { id: milestoneId } },
        body: { releaseIds } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['milestone', vars.milestoneId, 'releases'] })
      void qc.invalidateQueries({ queryKey: milestoneKeys.detail(vars.milestoneId) })
    },
  })
}

// ── Milestone Artifacts (linked work items) ────────────────────────────────────

export interface ArtifactItem {
  id: string
  itemKey: string
  type: string
  title: string
  scheduleState: string
  priority: string
  assigneeId: string | null
  assigneeName?: string | null
  storyPoints: number | null
  rank?: number
}

export interface ArtifactPageResponse {
  data: ArtifactItem[]
  pageInfo: { hasNextPage: boolean; nextCursor: string | null; limit: number; total?: number }
}

export function useMilestoneArtifacts(
  milestoneId: string | undefined,
  params?: { page?: number; pageSize?: number; search?: string },
) {
  return useQuery({
    queryKey: ['milestone', milestoneId, 'artifacts', params],
    queryFn: async () => {
      if (!milestoneId) return { data: [], pageInfo: { hasNextPage: false, nextCursor: null, limit: 50, total: 0 } }
      const { data, error, response } = await client.GET('/v1/milestones/{id}/artifacts', {
        params: {
          path: { id: milestoneId },
          query: {
            limit: params?.pageSize ?? 50,
            q: params?.search || undefined,
          },
        },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      const res = data as ArtifactPageResponse | undefined
      return {
        data: res?.data ?? [],
        pageInfo: res?.pageInfo ?? { hasNextPage: false, nextCursor: null, limit: 50, total: 0 },
      }
    },
    enabled: !!milestoneId,
    staleTime: 15_000,
  })
}

export function useSetMilestoneArtifacts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ milestoneId, workItemIds }: { milestoneId: string; workItemIds: string[] }) => {
      const { data, error, response } = await client.PUT('/v1/milestones/{id}/artifacts', {
        params: { path: { id: milestoneId } },
        body: { workItemIds } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['milestone', vars.milestoneId, 'artifacts'] })
    },
  })
}