/**
 * Releases API hooks — TanStack Query wrappers.
 * P3.2: Updated for Planning/Active/Accepted states and new fields.
 */
import { useMemo } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'

export type ReleaseActivityLog = components['schemas']['ActivityResponseDto']

/** Revision History (activity log) for one release — newest first. */
export function useReleaseActivityLog(releaseId: string | undefined) {
  return useQuery({
    queryKey: ['release', releaseId ?? '', 'activity'] as const,
    queryFn: async () => {
      if (!releaseId) return []
      const { data, error, response } = await apiClient.GET('/v1/releases/{id}/activity', {
        params: { path: { id: releaseId }, query: { page: 1, pageSize: 100 } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as { data?: ReleaseActivityLog[] } | undefined)?.data ?? []
    },
    enabled: !!releaseId,
    staleTime: 15_000,
  })
}

// ── Types ────────────────────────────────────────────────────────────────────

export type ReleaseStatus = 'planning' | 'active' | 'accepted'

/**
 * The Release detail's right-panel roll-up (P3-REL-FR-018): Task Roll-up hours (FR-023) and the
 * accepted work total (FR-024).
 *
 * No percentage and no point totals, deliberately. FR-037: "Phase 3 Release list/detail must not
 * add a Release Progress column/widget; progress/tracking belongs to
 * `Portfolio > Release Tracking`", and §7.5 defers the progress percentage out of Phase 3.2. The
 * API no longer computes or serves those fields, so this mirror does not declare them.
 */
export interface TaskRollup {
  estimateHours: number
  toDoHours: number
  actualHours: number
  acceptedItems: number
}

export interface Release {
  id: string
  tenantId: string
  projectId: string
  releaseKey: string | null
  name: string
  description: string | null
  theme: string | null
  notes: string | null
  releaseNotes: string | null
  status: ReleaseStatus
  startDate: string | null
  releaseDate: string | null
  targetDate: string | null
  plannedVelocity: number | null
  planEstimate: number | null
  /** Read-only roll-up: summed estimate hours of assigned work items (SRS FR-004). */
  taskEstimate: number
  version: string | null
  releasedAt: string | null
  createdAt: string
  updatedAt: string
  taskRollup?: TaskRollup
}

// ── Keys ─────────────────────────────────────────────────────────────────────

export const releaseKeys = {
  all: ['releases'] as const,
  list: (projectId: string) => [...releaseKeys.all, 'list', projectId] as const,
  detail: (id: string) => [...releaseKeys.all, 'detail', id] as const,
} as const

// ── Queries ──────────────────────────────────────────────────────────────────

/** Shared fetcher so single- and multi-project hooks stay in lockstep. */
async function fetchReleases(projectId: string): Promise<Release[]> {
  const { data, error, response } = await apiClient.GET('/v1/releases', {
    params: { query: { projectId } },
  })
  if (error) throw new Error(apiErrorMessage(error, response.status))
  return ((data as { data?: Release[] } | undefined)?.data ?? []) as Release[]
}

export function useReleases(projectId: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.list(projectId ?? ''),
    queryFn: () => fetchReleases(projectId as string),
    enabled: !!projectId,
    staleTime: 60_000,
  })
}

/**
 * Union of releases across several projects (deduped by id). Used where an
 * entity spans multiple projects — e.g. a milestone linked to more than one
 * project needs every linked project's releases as selectable options.
 * Reuses `releaseKeys.list` so results share cache with `useReleases`.
 */
export function useReleasesForProjects(projectIds: readonly string[]) {
  const ids = useMemo(() => [...new Set(projectIds.filter(Boolean))], [projectIds])
  const results = useQueries({
    queries: ids.map((projectId) => ({
      queryKey: releaseKeys.list(projectId),
      queryFn: () => fetchReleases(projectId),
      staleTime: 60_000,
    })),
  })
  const isLoading = results.some((r) => r.isLoading)
  // Stable signature of the fetched pages so the memo only recomputes when the
  // underlying release data actually changes, not on every render.
  const signature = results.map((r) => r.dataUpdatedAt).join(',')
  const data = useMemo(() => {
    const byId = new Map<string, Release>()
    for (const r of results) for (const rel of r.data ?? []) byId.set(rel.id, rel)
    return [...byId.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
  return { data, isLoading }
}

/**
 * One release by id — the resolver behind the `/releases/$releaseId` deep link.
 *
 * A release id is workspace-unique and `GET /releases/:id` resolves the owning project from the row
 * before authorizing it (`PolicyGuard`, `resource: 'release'`), so the URL carries no project and
 * does not need to. Exposed as query OPTIONS as well as a hook because the route loader resolves the
 * release outside React, to adopt its project before the first paint — same key, so the loader's
 * fetch warms the cache this hook reads.
 */
export function releaseQueryOptions(id: string) {
  return {
    queryKey: releaseKeys.detail(id),
    queryFn: async (): Promise<Release | null> => {
      if (!id) return null
      const { data, error, response } = await apiClient.GET('/v1/releases/{id}', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as unknown as Release
    },
    staleTime: 30_000,
  }
}

export function useRelease(id: string | undefined) {
  return useQuery({ ...releaseQueryOptions(id ?? ''), enabled: !!id })
}

// `useReleaseBurndown` used to sit here and is deliberately gone with the panel it fed. A release
// burndown is Phase 6 `Portfolio > Release Tracking` (P3-REL-FR-037, §7.5), and a request whose
// result nothing renders is worse than no request: it cost every Release detail open a round trip
// to `GET /releases/:id/burndown` for a table the BA says not to show.

// ── Mutations ────────────────────────────────────────────────────────────────

export interface CreateReleaseInput {
  projectId: string
  name: string
  description?: string
  theme?: string
  startDate?: string
  releaseDate?: string
  state?: ReleaseStatus
}

export function useCreateRelease() {
  return useMutation({
    mutationFn: async (body: CreateReleaseInput) => {
      const { data, error, response } = await apiClient.POST('/v1/releases', {
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as unknown as Release
    },
    meta: { invalidates: ['release'] },
  })
}

export interface UpdateReleaseInput {
  name?: string
  description?: string | null
  theme?: string | null
  notes?: string | null
  releaseNotes?: string | null
  startDate?: string | null
  releaseDate?: string | null
  plannedVelocity?: number | null
  planEstimate?: number | null
  version?: string | null
  state?: ReleaseStatus
}

export function useUpdateRelease(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpdateReleaseInput) => {
      const { data, error, response } = await apiClient.PATCH('/v1/releases/{id}', {
        params: { path: { id } },
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as unknown as Release
    },
    // Clear the detail cache so the refetch (triggered by the registry) can't
    // briefly show a stale copy; `projectId` retained for call-site symmetry.
    onSuccess: () => qc.setQueryData(releaseKeys.detail(id), undefined),
    meta: { invalidates: ['release'] },
  })
}

export function useDeleteRelease() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, response } = await apiClient.DELETE('/v1/releases/{id}', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidates: ['release'] },
  })
}

// Inline edit helper — optimistic update for a single field.
export function useInlineReleaseField(id: string, field: keyof UpdateReleaseInput) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (value: unknown) => {
      const patch: UpdateReleaseInput = { [field]: value }
      const { data, error, response } = await apiClient.PATCH('/v1/releases/{id}', {
        params: { path: { id } },
        body: patch as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as unknown as Release
    },
    onSuccess: () => qc.setQueryData(releaseKeys.detail(id), undefined),
    meta: { invalidates: ['release'] },
  })
}

// ── Release Artifacts (linked work items) ───────────────────────────────────────

export interface ReleaseArtifactItem {
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

export interface ReleaseArtifactPageResponse {
  data: ReleaseArtifactItem[]
  pageInfo: { hasNextPage: boolean; nextCursor: string | null; limit: number; total?: number }
}

export function useReleaseArtifacts(
  releaseId: string | undefined,
  params?: { page?: number; pageSize?: number; search?: string },
) {
  return useQuery({
    queryKey: ['release', releaseId, 'artifacts', params],
    queryFn: async () => {
      if (!releaseId)
        return { data: [], pageInfo: { hasNextPage: false, nextCursor: null, limit: 50, total: 0 } }
      const customClient = apiClient as unknown as {
        GET: (
          url: string,
          options: {
            params: {
              path: { id: string }
              query: { limit: number; q: string | undefined }
            }
          },
        ) => Promise<{
          data?: ReleaseArtifactPageResponse
          error?: unknown
          response: { status: number }
        }>
      }
      const { data, error, response } = await customClient.GET('/v1/releases/{id}/artifacts', {
        params: {
          path: { id: releaseId },
          query: {
            limit: params?.pageSize ?? 50,
            q: params?.search || undefined,
          },
        },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      const res = data
      return {
        data: res?.data ?? [],
        pageInfo: res?.pageInfo ?? { hasNextPage: false, nextCursor: null, limit: 50, total: 0 },
      }
    },
    enabled: !!releaseId,
    staleTime: 15_000,
  })
}

/**
 * Add and remove Release artifacts from the Release detail surface (P3-REL-FR-029, Q02 "support both
 * Backlog/Work Item Detail AND Release detail/artifact surface").
 *
 * A release owns no join table — its artifacts ARE the work items whose `release_id` points at it —
 * so this writes through `PATCH /work-items/bulk-release`, the endpoint that already owns that
 * column. Deliberate reuse rather than a new `PUT /releases/:id/artifacts`: the SRS specifies no
 * write route here, and the bulk path already enforces the project scope, the archived-project guard
 * (`loadBulkItems` → `assertProjectWritable`) and `assertReleaseAssignable`. Assigning an item that
 * belongs to another release REPLACES that assignment, which is FR-031; clearing is `releaseId: null`,
 * the mockup's "Unscheduled". Neither touches iteration or milestone assignment (§7.5:
 * "Reassignment must not alter Iteration or Milestone assignment").
 *
 * Tagged `release` as well as `work-item` because `work-item` alone does NOT fan out to `['release']`
 * — and the old and new Artifacts views plus the detail roll-ups are exactly what FR-036/FR-038
 * require to refresh.
 */
export function useSetReleaseArtifacts() {
  return useMutation({
    mutationFn: async ({
      projectId,
      releaseId,
      add,
      remove,
    }: {
      projectId: string
      releaseId: string
      add: string[]
      remove: string[]
    }) => {
      const assign = async (itemIds: string[], target: string | null) => {
        if (itemIds.length === 0) return
        const { error, response } = await apiClient.PATCH('/v1/work-items/bulk-release', {
          body: { projectId, itemIds, releaseId: target },
        })
        if (error) throw new Error(apiErrorMessage(error, response.status))
      }
      // Unassign first: an item cannot be in two releases, so the order only matters for the failure
      // mode, and dropping before adding keeps a partial failure from over-filling the release.
      await assign(remove, null)
      await assign(add, releaseId)
    },
    meta: { invalidates: ['release', 'work-item'] },
  })
}
