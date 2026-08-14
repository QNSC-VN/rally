/**
 * Projects API hooks — TanStack Query wrappers.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'

export type ProjectActivityLog = components['schemas']['ActivityResponseDto']

/** Revision History (activity log) for one project — newest first. */
export function useProjectActivityLog(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project', projectId ?? '', 'activity'] as const,
    queryFn: async () => {
      if (!projectId) return []
      const { data, error, response } = await apiClient.GET('/v1/projects/{id}/activity', {
        params: { path: { id: projectId }, query: { page: 1, pageSize: 100 } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as { data?: ProjectActivityLog[] } | undefined)?.data ?? []
    },
    enabled: !!projectId,
    staleTime: 15_000,
  })
}

export interface Project {
  id: string
  workspaceId: string
  key: string
  name: string
  description: string | null
  leadId: string | null
  leadName: string | null
  startDate: string | null
  endDate: string | null
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
  startDate?: string
  endDate?: string
  teamIds?: string[]
  /**
   * §4.2 makes the estimate scale part of Create Project, so it travels in the create body.
   * It used to be a SECOND request — a best-effort PATCH the modal skipped whenever the six
   * values still equalled the defaults, and swallowed on failure — which left the common path
   * with no `project_settings` row at all. The API writes the row in the create transaction now.
   */
  estimationSettings?: ProjectEstimationSettings
}

export interface UpdateProjectInput {
  name?: string
  description?: string | null
  leadId?: string | null
  startDate?: string | null
  endDate?: string | null
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
  return useMutation({
    mutationFn: async (input: CreateProjectInput) => {
      const { data, error, response } = await apiClient.POST('/v1/projects', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: input as any,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as Project
    },
    meta: { invalidates: ['project'] },
  })
}

export function useUpdateProject() {
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
    meta: { invalidates: ['project'] },
  })
}

export function useDeleteProject() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, response } = await apiClient.DELETE('/v1/projects/{id}', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidates: ['project'] },
  })
}

// ── Estimation Settings (SRS §6.2) ────────────────────────────────────────────

export interface ProjectEstimationSettings {
  xsPoints: number
  sPoints: number
  mPoints: number
  lPoints: number
  xlPoints: number
  hoursPerPoint: number
}

/**
 * Persist the per-project T-shirt → points scale + hours/point. Write side is
 * Workspace-Admin only on the backend (`workspace:edit`); the caller gates the UI to
 * match. Omitted fields keep their current value (PATCH, not replace).
 */
export function useUpdateProjectEstimationSettings() {
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string
      input: Partial<ProjectEstimationSettings>
    }) => {
      const { data, error, response } = await apiClient.PATCH(
        '/v1/projects/{id}/estimation-settings',
        { params: { path: { id } }, body: input },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as ProjectEstimationSettings
    },
    meta: { invalidates: ['project'] },
  })
}

/**
 * Read a project's estimation scale (SRS §6.2). Returns the stored values or, when
 * no row exists, the backend's default scale (1/3/5/8/13 + 8) — so the Details tab
 * always shows the effective scale the progress bars compute with.
 */
export function useProjectEstimationSettings(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-estimation-settings', projectId ?? ''],
    queryFn: async () => {
      if (!projectId) return null
      const { data, error, response } = await apiClient.GET(
        '/v1/projects/{id}/estimation-settings',
        { params: { path: { id: projectId } } },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as ProjectEstimationSettings
    },
    enabled: !!projectId,
    staleTime: 30_000,
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
  isDefault: boolean
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

// ── Workflow status mutations ──────────────────────────────────────────────────

export interface CreateStatusInput {
  name: string
  category: 'to_do' | 'in_progress' | 'done'
  color?: string
  isDefault?: boolean
}

export function useCreateStatus(projectId: string | undefined) {
  return useMutation({
    mutationFn: async (input: CreateStatusInput) => {
      if (!projectId) throw new Error('No project selected')
      const { data, error, response } = await apiClient.POST('/v1/projects/{projectId}/statuses', {
        params: { path: { projectId } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: input as any,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as ProjectStatus
    },
    meta: { invalidates: ['project'] },
  })
}

export function useDeleteStatus(projectId: string | undefined) {
  return useMutation({
    mutationFn: async (statusId: string) => {
      if (!projectId) throw new Error('No project selected')
      const { error, response } = await apiClient.DELETE(
        '/v1/projects/{projectId}/statuses/{statusId}',
        {
          params: { path: { projectId, statusId } },
        },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidates: ['project'] },
  })
}

export function useReorderStatuses(projectId: string | undefined) {
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      if (!projectId) throw new Error('No project selected')
      const { error, response } = await apiClient.PATCH(
        '/v1/projects/{projectId}/statuses/reorder',
        {
          params: { path: { projectId } },
          body: { orderedIds },
        },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidates: ['project'] },
  })
}

// ── Project Labels ─────────────────────────────────────────────────────────────

export interface ProjectLabel {
  id: string
  projectId: string
  name: string
  color: string
  createdAt: string
  updatedAt: string
}

export interface CreateLabelInput {
  name: string
  color?: string
}

export interface UpdateLabelInput {
  name?: string
  color?: string
}

export function useProjectLabels(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-labels', projectId],
    queryFn: async () => {
      if (!projectId) return []
      const { data, error, response } = await apiClient.GET('/v1/projects/{id}/labels', {
        params: { path: { id: projectId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as ProjectLabel[]) ?? []
    },
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  })
}

export function useCreateLabel(projectId: string | undefined) {
  return useMutation({
    mutationFn: async (input: CreateLabelInput) => {
      if (!projectId) throw new Error('No project selected')
      const { data, error, response } = await apiClient.POST('/v1/projects/{id}/labels', {
        params: { path: { id: projectId } },
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as ProjectLabel
    },
    meta: { invalidates: ['project'] },
  })
}

export function useUpdateLabel(projectId: string | undefined) {
  return useMutation({
    mutationFn: async ({ labelId, input }: { labelId: string; input: UpdateLabelInput }) => {
      if (!projectId) throw new Error('No project selected')
      const { data, error, response } = await apiClient.PATCH(
        '/v1/projects/{id}/labels/{labelId}',
        {
          params: { path: { id: projectId, labelId } },
          body: input,
        },
      )
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as ProjectLabel
    },
    meta: { invalidates: ['project'] },
  })
}

export function useDeleteLabel(projectId: string | undefined) {
  return useMutation({
    mutationFn: async (labelId: string) => {
      if (!projectId) throw new Error('No project selected')
      const { error, response } = await apiClient.DELETE('/v1/projects/{id}/labels/{labelId}', {
        params: { path: { id: projectId, labelId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidates: ['project'] },
  })
}
