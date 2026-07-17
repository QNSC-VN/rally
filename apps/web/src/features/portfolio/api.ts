/**
 * Portfolio API — the Initiative → Feature → Story rollup tree.
 *
 * There is no dedicated portfolio backend module; the hierarchy already exists
 * on the work-item graph (`type` ∈ initiative|feature|story, linked by
 * `parentId`). This hook reads the three levels from the standard work-item
 * list endpoint (paginating fully so rollups are exact) and `buildPortfolio`
 * assembles the tree + rollup metrics as pure, testable domain logic.
 */
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { WorkItem } from '@/features/work-items/api'
import { ScheduleState } from '@/entities/work-item/model/types'

export type PortfolioItemType = 'initiative' | 'feature' | 'story'

export interface PortfolioRollup {
  totalStories: number
  acceptedStories: number
  totalPoints: number
  acceptedPoints: number
  blockedCount: number
  /** 0–100, accepted stories over total stories. */
  progressPct: number
}

export interface PortfolioNode {
  item: WorkItem
  children: PortfolioNode[]
  rollup: PortfolioRollup
}

export interface PortfolioData {
  tree: PortfolioNode[]
  metrics: {
    initiatives: number
    features: number
    totalStories: number
    acceptedStories: number
    totalPoints: number
  }
}

const DONE_STATES = new Set<string>([ScheduleState.Accepted, ScheduleState.Release])

/** A story counts as "accepted" once it reaches Accepted or Release. */
export function isStoryAccepted(story: WorkItem): boolean {
  return DONE_STATES.has(story.scheduleState)
}

function emptyRollup(): PortfolioRollup {
  return {
    totalStories: 0,
    acceptedStories: 0,
    totalPoints: 0,
    acceptedPoints: 0,
    blockedCount: 0,
    progressPct: 0,
  }
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

/**
 * Assemble the strict Initiative → Feature → Story tree with bottom-up rollups.
 * Features/stories outside the initiative hierarchy are intentionally excluded
 * (they surface in the Backlog, not the portfolio rollup).
 */
export function buildPortfolio(
  initiatives: WorkItem[],
  features: WorkItem[],
  stories: WorkItem[],
): PortfolioData {
  const storiesByParent = new Map<string, WorkItem[]>()
  for (const s of stories) {
    if (!s.parentId) continue
    const list = storiesByParent.get(s.parentId)
    if (list) list.push(s)
    else storiesByParent.set(s.parentId, [s])
  }

  const featuresByParent = new Map<string, WorkItem[]>()
  for (const f of features) {
    if (!f.parentId) continue
    const list = featuresByParent.get(f.parentId)
    if (list) list.push(f)
    else featuresByParent.set(f.parentId, [f])
  }

  const rank = (a: WorkItem, b: WorkItem) => a.rank.localeCompare(b.rank)

  function buildFeature(feature: WorkItem): PortfolioNode {
    const childStories = (storiesByParent.get(feature.id) ?? []).sort(rank)
    const rollup = emptyRollup()
    const children = childStories.map((story) => {
      const accepted = isStoryAccepted(story)
      const points = story.storyPoints ?? 0
      rollup.totalStories += 1
      rollup.totalPoints += points
      if (accepted) {
        rollup.acceptedStories += 1
        rollup.acceptedPoints += points
      }
      if (story.isBlocked) rollup.blockedCount += 1
      return {
        item: story,
        children: [],
        rollup: {
          ...emptyRollup(),
          totalStories: 1,
          acceptedStories: accepted ? 1 : 0,
          totalPoints: points,
          acceptedPoints: accepted ? points : 0,
          blockedCount: story.isBlocked ? 1 : 0,
          progressPct: accepted ? 100 : 0,
        },
      }
    })
    rollup.progressPct = pct(rollup.acceptedStories, rollup.totalStories)
    return { item: feature, children, rollup }
  }

  function accumulate(target: PortfolioRollup, source: PortfolioRollup) {
    target.totalStories += source.totalStories
    target.acceptedStories += source.acceptedStories
    target.totalPoints += source.totalPoints
    target.acceptedPoints += source.acceptedPoints
    target.blockedCount += source.blockedCount
  }

  const tree = [...initiatives].sort(rank).map((initiative) => {
    const childFeatures = (featuresByParent.get(initiative.id) ?? []).sort(rank)
    const rollup = emptyRollup()
    const children = childFeatures.map((feature) => {
      const node = buildFeature(feature)
      accumulate(rollup, node.rollup)
      if (feature.isBlocked) rollup.blockedCount += 1
      return node
    })
    rollup.progressPct = pct(rollup.acceptedStories, rollup.totalStories)
    return { item: initiative, children, rollup }
  })

  return {
    tree,
    metrics: {
      initiatives: initiatives.length,
      features: features.length,
      totalStories: stories.length,
      acceptedStories: stories.filter(isStoryAccepted).length,
      totalPoints: stories.reduce((sum, s) => sum + (s.storyPoints ?? 0), 0),
    },
  }
}

/** Fetch every page of a work-item type for a project (portfolio rollups must
 * be exact, so we never truncate to the first page). */
async function fetchAllOfType(projectId: string, type: PortfolioItemType): Promise<WorkItem[]> {
  const out: WorkItem[] = []
  let cursor: string | undefined
  // Hard safety cap to avoid an unbounded loop on a malformed cursor.
  for (let page = 0; page < 50; page += 1) {
    const { data, error, response } = await apiClient.GET('/v1/work-items', {
      params: { query: { projectId, type, limit: 100, cursor } },
    })
    if (error) throw new Error(apiErrorMessage(error, response.status))
    const payload = data as
      | { data?: WorkItem[]; pageInfo?: { nextCursor: string | null; hasNextPage: boolean } }
      | undefined
    out.push(...(payload?.data ?? []))
    if (!payload?.pageInfo?.hasNextPage || !payload.pageInfo.nextCursor) break
    cursor = payload.pageInfo.nextCursor
  }
  return out
}

export const portfolioKeys = {
  all: ['portfolio'] as const,
  tree: (projectId: string) => ['portfolio', projectId] as const,
}

export function usePortfolio(projectId: string | undefined) {
  return useQuery({
    queryKey: portfolioKeys.tree(projectId ?? ''),
    queryFn: async () => {
      if (!projectId) return buildPortfolio([], [], [])
      const [initiatives, features, stories] = await Promise.all([
        fetchAllOfType(projectId, 'initiative'),
        fetchAllOfType(projectId, 'feature'),
        fetchAllOfType(projectId, 'story'),
      ])
      return buildPortfolio(initiatives, features, stories)
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })
}
