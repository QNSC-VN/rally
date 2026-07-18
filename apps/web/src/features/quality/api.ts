/**
 * Quality/Defect API hooks — TanStack Query wrappers.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
// Single source of truth for severity lives in the entity layer.
export type { DefectSeverity } from '@/entities/work-item/model/types'
import type { DefectSeverity } from '@/entities/work-item/model/types'

export type DefectEnvironment = 'development' | 'staging' | 'production' | 'testing'

export interface DefectMetrics {
  openDefects: number
  critical: number
  inProgress: number
  verifiedAccepted: number
  reopened: number
  blockers: number
}

export interface DefectRow {
  id: string
  itemKey: string
  title: string
  type: string
  priority: string
  severity: DefectSeverity | null
  foundInEnvironment: DefectEnvironment | null
  rootCause: string | null
  resolution: string | null
  foundInReleaseId: string | null
  foundInReleaseName: string | null
  assigneeId: string | null
  assigneeName: string | null
  scheduleState: string
  defectState: string | null
  fixedInBuild: string | null
  iterationId: string | null
  iterationName: string | null
  releaseId: string | null
  releaseName: string | null
  parentId: string | null
  parentKey: string | null
  parentTitle: string | null
  isBlocked: boolean
  rank: string
  createdById: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

export interface DefectListResult {
  metrics: DefectMetrics
  data: DefectRow[]
}

export const qualityKeys = {
  all: ['quality'] as const,
  defects: (projectId: string, filters?: Record<string, string>) =>
    [...qualityKeys.all, 'defects', projectId, filters] as const,
} as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = apiClient as any

export function useDefects(
  projectId: string | undefined,
  filters?: {
    search?: string
    severity?: string
    environment?: string
    priority?: string
    scheduleState?: string
    assigneeId?: string
    releaseId?: string
    rootCause?: string
    resolution?: string
    defectState?: string
    /** Server-side sort as `"<field>[:asc|:desc]"`; omit for the default rank order. */
    sort?: string
  },
) {
  return useQuery({
    queryKey: qualityKeys.defects(projectId ?? '', filters as Record<string, string>),
    queryFn: async () => {
      if (!projectId) return { metrics: emptyMetrics(), data: [] } as DefectListResult
      const { data, error, response } = await client.GET('/v1/quality/defects', {
        params: {
          query: {
            projectId,
            search: filters?.search,
            severity: filters?.severity,
            environment: filters?.environment,
            priority: filters?.priority,
            scheduleState: filters?.scheduleState,
            assigneeId: filters?.assigneeId,
            releaseId: filters?.releaseId,
            rootCause: filters?.rootCause,
            resolution: filters?.resolution,
            defectState: filters?.defectState,
            sort: filters?.sort,
          } as never,
        },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as DefectListResult
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })
}

export interface CreateDefectInput {
  projectId: string
  title: string
  description?: string
  priority?: string
  severity?: string
  foundInEnvironment?: string
  foundInReleaseId?: string
  assigneeId?: string
  iterationId?: string
  releaseId?: string
  rootCause?: string
  notes?: string
}

export function useCreateDefect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: CreateDefectInput) => {
      const res = await fetch('/api/v1/work-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: body.projectId,
          type: 'defect',
          title: body.title,
          description: body.description,
          priority: body.priority ?? 'normal',
          severity: body.severity,
          foundInEnvironment: body.foundInEnvironment,
          foundInReleaseId: body.foundInReleaseId,
          assigneeId: body.assigneeId,
          iterationId: body.iterationId,
          releaseId: body.releaseId,
          rootCause: body.rootCause,
          notes: body.notes,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.message ?? `Failed to create defect (${res.status})`)
      }
      return json
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qualityKeys.all })
    },
  })
}

function emptyMetrics(): DefectMetrics {
  return {
    openDefects: 0,
    critical: 0,
    inProgress: 0,
    verifiedAccepted: 0,
    reopened: 0,
    blockers: 0,
  }
}
