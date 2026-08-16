/**
 * Milestones API hooks — TanStack Query wrappers.
 */
import { useMemo } from 'react'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'

export type MilestoneActivityLog = components['schemas']['ActivityResponseDto']

/** Revision History (activity log) for one milestone — newest first. */
export function useMilestoneActivityLog(milestoneId: string | undefined) {
  return useQuery({
    queryKey: ['milestone', milestoneId ?? '', 'activity'] as const,
    queryFn: async () => {
      if (!milestoneId) return []
      const { data, error, response } = await apiClient.GET('/v1/milestones/{id}/activity', {
        params: { path: { id: milestoneId }, query: { page: 1, pageSize: 100 } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as { data?: MilestoneActivityLog[] } | undefined)?.data ?? []
    },
    enabled: !!milestoneId,
    staleTime: 15_000,
  })
}

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
  milestoneKey: string | null
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

/**
 * The ADMINISTRATIVE milestone list — the whole record, for the `Plan > Milestones` grid and detail.
 *
 * `milestone:view`, so a project Editor gets a 403 here BY DESIGN (§3.2 hides the surface). Anything
 * that only needs to name, choose or scope a milestone must call {@link useMilestoneOptions};
 * pointing a picker back at this hook is the defect the split exists to prevent.
 */
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

/**
 * The MILESTONE REFERENCE projection — what a picker needs to label, choose and scope one.
 *
 * Mirrors `MilestoneOptionDto` (`GET /v1/milestones/options`). Hand-declared until the next central
 * `codegen` run; the field names are the contract. Deliberately NOT `Pick<Milestone, …>`:
 * {@link Milestone} is the administration record, and a shared base is how a field added there later
 * joins the feed every participant reads.
 */
export interface MilestoneOption {
  id: string
  projectId: string
  milestoneKey: string | null
  name: string
  releaseIds: string[]
}

/**
 * The MILESTONE REFERENCE feed. Read this from any picker, filter or name lookup.
 *
 * WHY NOT {@link useMilestones}. That hook reads `GET /v1/milestones`, the `Plan > Milestones`
 * administration grid's feed: it carries the milestone RECORD (description, notes, status, owner,
 * target window, linked projects and teams, computed progress) and takes `milestone:view` — a code
 * §3.2 withholds from a project Editor. It was ALSO the only feed for the Milestones column and
 * picker on Iteration Status and the Work Item detail sidebar, both of which an Editor may use and
 * both of which default a failed request to `[]`, so an item's real milestones rendered as none.
 *
 * Every picker now reads this feed; `useMilestones` is left only to `pages/milestones/`, its own
 * administration grid, which `test/fe-consistency.ratchet.test.ts` pins by path. The SERVER half is
 * closed too — `test/route-audience.ratchet.spec.ts` and `test/e2e/authz-cluster.e2e.spec.ts` both
 * assert an Editor can read this route.
 */
export function useMilestoneOptions(projectId: string | undefined) {
  return useQuery({
    queryKey: [...milestoneKeys.all, 'options', projectId ?? ''] as const,
    queryFn: async () => {
      if (!projectId) return []
      const { data, error, response } = await client.GET('/v1/milestones/options', {
        params: { query: { projectId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as MilestoneOption[] | undefined) ?? []
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
  return useMutation({
    mutationFn: async (body: CreateMilestoneInput) => {
      const { data, error, response } = await client.POST('/v1/milestones', {
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as unknown as Milestone
    },
    meta: { invalidates: ['milestone'] },
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
  projectIds?: string[]
  teamIds?: string[]
}

export function useUpdateMilestone() {
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateMilestoneInput & { id: string }) => {
      const { data, error, response } = await client.PATCH('/v1/milestones/{id}', {
        params: { path: { id } },
        body: body as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as unknown as Milestone
    },
    // The `milestone` tag covers both the plural list/detail roots and the
    // separate singular ['milestone', id, …] relation namespace.
    meta: { invalidates: ['milestone'] },
  })
}

export function useDeleteMilestone() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, response } = await client.DELETE('/v1/milestones/{id}', {
        params: { path: { id } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: { invalidates: ['milestone'] },
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
      return (data as string[] | undefined) ?? []
    },
    enabled: !!milestoneId,
    staleTime: 30_000,
  })
}

export function useSetMilestoneProjects() {
  return useMutation({
    mutationFn: async ({
      milestoneId,
      projectIds,
    }: {
      milestoneId: string
      projectIds: string[]
    }) => {
      const { data, error, response } = await client.PUT('/v1/milestones/{id}/projects', {
        params: { path: { id: milestoneId } },
        body: { projectIds } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    meta: { invalidates: ['milestone'] },
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
      return (data as string[] | undefined) ?? []
    },
    enabled: !!milestoneId,
    staleTime: 30_000,
  })
}

export function useSetMilestoneTeams() {
  return useMutation({
    mutationFn: async ({ milestoneId, teamIds }: { milestoneId: string; teamIds: string[] }) => {
      const { data, error, response } = await client.PUT('/v1/milestones/{id}/teams', {
        params: { path: { id: milestoneId } },
        body: { teamIds } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    meta: { invalidates: ['milestone'] },
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
      return (data as string[] | undefined) ?? []
    },
    enabled: !!milestoneId,
    staleTime: 30_000,
  })
}

export function useSetMilestoneReleases() {
  return useMutation({
    mutationFn: async ({
      milestoneId,
      releaseIds,
    }: {
      milestoneId: string
      releaseIds: string[]
    }) => {
      const { data, error, response } = await client.PUT('/v1/milestones/{id}/releases', {
        params: { path: { id: milestoneId } },
        body: { releaseIds } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    meta: { invalidates: ['milestone'] },
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

/** One row the `Add Artifact` picker can offer — the fields its eligibility rule and label read. */
export interface ArtifactCandidate {
  id: string
  itemKey: string
  title: string
  type: string
  teamId: string | null
  releaseId: string | null
}

/**
 * `MAX_LIMIT` on the shared page query. Past this the picker offers the first page only — the same
 * ceiling `useProjects` already lives with, and the reason the modal carries its own search box.
 */
const ARTIFACT_CANDIDATE_LIMIT = 100

const EMPTY_ARTIFACT_PAGE: ArtifactPageResponse = {
  data: [],
  pageInfo: { hasNextPage: false, nextCursor: null, limit: 50, total: 0 },
}

/**
 * The Artifacts DASHBOARD rows (P3-MS-FR-019/020).
 *
 * Reads `:id/artifacts/items`, not `:id/artifacts`. The latter answers with the LINK ids that the
 * §5.2 replace-set write takes back; this hook used to call it and read `{ data, pageInfo }` off a
 * bare array, so both were `undefined` and the tab rendered "No artifacts linked to this milestone"
 * for every milestone — including the seeded `MS-1`, which has had a linked story all along.
 */
export function useMilestoneArtifacts(
  milestoneId: string | undefined,
  params?: { page?: number; pageSize?: number; search?: string },
) {
  return useQuery({
    queryKey: ['milestone', milestoneId, 'artifacts', 'items', params],
    queryFn: async () => {
      if (!milestoneId) return EMPTY_ARTIFACT_PAGE
      const { data, error, response } = (await client.GET('/v1/milestones/{id}/artifacts/items', {
        params: {
          path: { id: milestoneId },
          query: { limit: params?.pageSize ?? 50, q: params?.search || undefined },
        },
      })) as { data?: ArtifactPageResponse; error?: unknown; response: { status: number } }
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return {
        data: data?.data ?? [],
        pageInfo: data?.pageInfo ?? EMPTY_ARTIFACT_PAGE.pageInfo,
      }
    },
    enabled: !!milestoneId,
    staleTime: 15_000,
  })
}

/**
 * The milestone's DIRECT artifact LINK ids — the full set, not one page, and both entity types.
 *
 * The picker needs all of them: `PUT :id/artifacts` REPLACES the list, so saving a set built from a
 * single page of rows would silently unlink everything past the page boundary. The server used to
 * filter this to `entity_type = 'work_item'`, so a Feature or Epic assigned to the milestone was
 * absent from the baseline and could be neither seen ticked nor removed from this end.
 */
export function useMilestoneArtifactIds(milestoneId: string | undefined) {
  return useQuery({
    queryKey: ['milestone', milestoneId, 'artifact-ids'],
    queryFn: async () => {
      if (!milestoneId) return []
      const { data, error, response } = await client.GET('/v1/milestones/{id}/artifacts', {
        params: { path: { id: milestoneId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as string[] | undefined) ?? []
    },
    enabled: !!milestoneId,
    staleTime: 15_000,
  })
}

/**
 * The four PORTFOLIO list calls a milestone's project scope needs, one per (project, type).
 *
 * `GET /v1/portfolio-items` takes a REQUIRED `type` and no combined `All` — the BA's Type selector
 * has exactly two choices — so an Epic page and a Feature page are two requests, per project, the
 * same way the work-item feed is one per project. A milestone spanning several projects is the
 * exception (§4, Q06), and this mirrors `useReleasesForProjects`.
 */
const PORTFOLIO_ARTIFACT_TYPES = ['epic', 'feature'] as const

/**
 * Candidates for the `Add Artifact` picker, filtered to what the milestone's own scope rule will
 * actually accept, so the picker cannot offer a row the write refuses:
 *
 *   • Story, Defect, Feature and Epic — SRS:116 and FR-014. Anything else (a Task) is refused
 *     server-side as `MILESTONE_INVALID_ARTIFACT_TYPE`.
 *   • inside the milestone's Projects — its owning project plus any linked ones (§4, FR-021/023).
 *   • inside its selected Teams when it has any — and a team-agnostic item is OUT of a team scope,
 *     not exempt from it, which is what the server's `assertArtifactsInMilestoneScope` says too.
 *     **An EPIC is the one exemption**, because it has no team column at all
 *     (`ck_portfolio_epic_shape`; §11.1) — the server makes exactly the same exemption, and the two
 *     have to agree or the picker offers a row the write refuses (or hides one it would accept).
 *
 * TWO FEEDS, not one. It used to read `GET /work-items` alone and filter to `story|defect`, which is
 * why the Milestone end could not assign a Feature or Epic and — worse — could not REMOVE one: the
 * §5.2 payload replaces the whole direct list, and an artifact absent from `items` can never be
 * unticked, since `SelectionModal` only ever toggles rows it renders. So the missing half of this
 * feed was a data-visibility bug as much as a capability gap.
 */
export function useMilestoneArtifactCandidates(
  projectIds: readonly string[],
  teamIds: readonly string[],
) {
  const ids = useMemo(() => [...new Set(projectIds.filter(Boolean))], [projectIds])
  const results = useQueries({
    queries: [
      ...ids.map((projectId) => ({
        queryKey: ['work-items', 'list', projectId, { artifactCandidates: true }] as const,
        queryFn: async (): Promise<ArtifactCandidate[]> => {
          const { data, error, response } = (await client.GET('/v1/work-items', {
            params: { query: { projectId, limit: ARTIFACT_CANDIDATE_LIMIT } },
          })) as {
            data?: { data?: ArtifactCandidate[] }
            error?: unknown
            response: { status: number }
          }
          if (error) throw new Error(apiErrorMessage(error, response.status))
          // A Task is excluded by §116, and this endpoint serves all three work-item types.
          return (data?.data ?? []).filter((w) => w.type === 'story' || w.type === 'defect')
        },
        staleTime: 30_000,
      })),
      ...ids.flatMap((projectId) =>
        PORTFOLIO_ARTIFACT_TYPES.map((type) => ({
          queryKey: ['portfolio', 'list', projectId, { artifactCandidates: type }] as const,
          queryFn: async (): Promise<ArtifactCandidate[]> => {
            const { data, error, response } = (await client.GET('/v1/portfolio-items', {
              params: { query: { projectId, type, limit: ARTIFACT_CANDIDATE_LIMIT } },
            })) as {
              data?: {
                data?: { id: string; itemKey: string; name: string; teamId: string | null }[]
              }
              error?: unknown
              response: { status: number }
            }
            if (error) throw new Error(apiErrorMessage(error, response.status))
            // Projected onto the SHARED candidate shape: a portfolio item's label field is `name`
            // where a work item's is `title`, and it carries no Release. The list endpoint already
            // hides archived items, which §156 makes ineligible for new assignment anyway.
            return (data?.data ?? []).map((p) => ({
              id: p.id,
              itemKey: p.itemKey,
              title: p.name,
              type,
              teamId: p.teamId,
              releaseId: null,
            }))
          },
          staleTime: 30_000,
        })),
      ),
    ],
  })

  const isLoading = results.some((r) => r.isLoading)
  // Stable signature of the fetched pages, so the memo recomputes only when the underlying data
  // changes and not on every render — the same device `useReleasesForProjects` uses.
  const signature = results.map((r) => r.dataUpdatedAt).join(',')
  const teamKey = [...teamIds].sort().join(',')

  const items = useMemo(() => {
    const byId = new Map<string, ArtifactCandidate>()
    for (const r of results) for (const w of r.data ?? []) byId.set(w.id, w)
    const teamScope = teamKey ? new Set(teamKey.split(',')) : null
    const all = [...byId.values()]
    return teamScope
      ? // The Epic exemption, mirroring `assertArtifactsInMilestoneScope`. Everything else must name
        // a team inside the scope; `teamId == null` on a Feature or a Story means "not set", which is
        // outside a declared scope rather than exempt from it.
        all.filter((w) => w.type === 'epic' || (w.teamId != null && teamScope.has(w.teamId)))
      : all
    // `signature`/`teamKey` stand in for the fetched pages: `results` is a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, teamKey])

  return { items, isLoading }
}

/**
 * §5.2's replace-set write. The payload is `artifactIds`, RENAMED from `workItemIds` — the old name
 * asserted one table while `milestone_artifacts` is polymorphic and §116 admits four types, so a
 * Feature id under that key could only ever be refused.
 *
 * A REPLACE, so the caller must pass the whole direct set: see `useMilestoneArtifactIds` for why the
 * baseline is the full link list rather than the visible page.
 */
export function useSetMilestoneArtifacts() {
  return useMutation({
    mutationFn: async ({
      milestoneId,
      artifactIds,
    }: {
      milestoneId: string
      artifactIds: string[]
    }) => {
      const { data, error, response } = await client.PUT('/v1/milestones/{id}/artifacts', {
        params: { path: { id: milestoneId } },
        body: { artifactIds } as never,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data
    },
    // Linking an artifact to a milestone also affects the work-item and portfolio-item milestone
    // lists, which the `milestone` tag's fan-out covers.
    meta: { invalidates: ['milestone', 'portfolio'] },
  })
}
