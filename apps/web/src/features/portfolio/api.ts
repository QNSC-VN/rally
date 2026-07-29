/**
 * Portfolio API — Epics and Features from `work.portfolio_items`.
 *
 * This replaced a client-side rollup tree that walked `parentId` over work items
 * of type `initiative`/`feature`. Those types no longer exist: migration 0072
 * dropped them from `work_item_type` and the hierarchy moved to its own table, so
 * the old approach could not work even in principle — `/v1/work-items?type=feature`
 * now returns a 400.
 *
 * Rollups are computed SERVER-side (one aggregate per page, see
 * `portfolio-item.drizzle-repository.ts`). Doing it here again would mean
 * downloading every child story to add up points the API already summed, and the
 * two implementations would drift the first time "accepted" was redefined.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'
import type { PortfolioItemType } from '@/entities/work-item/model/types'

// ── Types ────────────────────────────────────────────────────────────────────

export type PortfolioItem = components['schemas']['PortfolioItemResponseDto']
export type PortfolioChild = components['schemas']['PortfolioChildResponseDto']
export type PortfolioItemState = PortfolioItem['state']
export type PreliminaryEstimateSize = PortfolioItem['preliminaryEstimate']

export interface PortfolioListFilter {
  /** Epic or Feature. There is no combined view — the spec's Type selector is exclusive. */
  type: PortfolioItemType
  projectId?: string
  teamId?: string
  includeArchived?: boolean
}

// ── Keys ─────────────────────────────────────────────────────────────────────

/**
 * Rooted at `['portfolio']`, which `WORK_ITEM_VIEW_ROOTS` in
 * `shared/api/invalidation.ts` already lists. That is what makes a story write
 * refresh these rollups — accepting a story changes its Feature's Percent Done,
 * and the tag fan-out is the only thing connecting the two.
 */
export const portfolioKeys = {
  all: ['portfolio'] as const,
  list: (filter: PortfolioListFilter) =>
    [
      'portfolio',
      'list',
      filter.type,
      filter.projectId ?? 'all',
      filter.teamId ?? 'all',
      filter.includeArchived ? 'with-archived' : 'active',
    ] as const,
  detail: (id: string) => ['portfolio', 'detail', id] as const,
  children: (id: string) => ['portfolio', 'children', id] as const,
  features: (id: string) => ['portfolio', 'features', id] as const,
}

// ── List ─────────────────────────────────────────────────────────────────────

/** Page size per request. The list drains every page, so this is a batch size. */
const PAGE_SIZE = 100
/** Stops an unbounded loop if a cursor ever fails to advance. */
const MAX_PAGES = 50

interface PortfolioPage {
  data: PortfolioItem[]
  pageInfo: { nextCursor: string | null; hasNextPage: boolean; limit: number; total?: number }
}

/**
 * Every Epic/Feature matching the filter, fetched page by page.
 *
 * `ListPageScaffold` paginates client-side, so it needs the whole filtered set to
 * page through — handing it only the first server page would show a grid that
 * looks complete while silently omitting everything past the first 100 rows.
 * Draining here keeps that correct at any size while leaving the shared scaffold
 * untouched.
 *
 * Filters that the API can answer (type/project/team/archived) are sent to the
 * server so `total` describes the real result set. Free-text search stays on the
 * client, matching every other list page, so typing does not refetch.
 */
export function usePortfolioItems(filter: PortfolioListFilter) {
  const query = useInfiniteQuery({
    queryKey: portfolioKeys.list(filter),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<PortfolioPage> => {
      const { data, error, response } = await apiClient.GET('/v1/portfolio-items', {
        params: {
          query: {
            type: filter.type,
            projectId: filter.projectId,
            teamId: filter.teamId,
            includeArchived: filter.includeArchived,
            limit: PAGE_SIZE,
            cursor: pageParam,
          },
        },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      const payload = data as Partial<PortfolioPage> | undefined
      return {
        data: payload?.data ?? [],
        pageInfo: payload?.pageInfo ?? { nextCursor: null, hasNextPage: false, limit: PAGE_SIZE },
      }
    },
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 30_000,
  })

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const loadedPages = query.data?.pages.length ?? 0
  // Deliberately NOT `maxPages`: that option is a sliding retention window, so it
  // would evict the EARLIEST pages once the limit was hit — the grid would lose
  // its top rows instead of stopping. Capping the fetch loop is what we want.
  const shouldLoadMore = hasNextPage && !isFetchingNextPage && loadedPages < MAX_PAGES

  // Pull the remaining pages as they arrive. In an effect, not in render: render
  // must stay pure, and fetching there re-enters on every commit.
  useEffect(() => {
    if (shouldLoadMore) void fetchNextPage()
  }, [shouldLoadMore, fetchNextPage])

  const items = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p.data), [query.data?.pages])

  return {
    items,
    /** Server-side count for the whole filter set — independent of what has loaded. */
    total: query.data?.pages[0]?.pageInfo.total,
    /** True until every page has landed, so callers can avoid showing a partial count. */
    isLoadingMore: hasNextPage || isFetchingNextPage,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}

// ── Single item ──────────────────────────────────────────────────────────────

export function usePortfolioItem(id: string | undefined) {
  return useQuery({
    queryKey: portfolioKeys.detail(id ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/portfolio-items/{id}', {
        params: { path: { id: id as string } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return data as PortfolioItem
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

/** Linked Stories/Defects under a Feature — the detail Children tab. */
export function usePortfolioChildren(id: string | undefined) {
  return useQuery({
    queryKey: portfolioKeys.children(id ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/portfolio-items/{id}/children', {
        params: { path: { id: id as string }, query: { limit: PAGE_SIZE } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as { data?: PortfolioChild[] } | undefined)?.data ?? []
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

/** Child Features under an Epic — the detail Children tab for the upper level. */
export function usePortfolioChildFeatures(id: string | undefined) {
  return useQuery({
    queryKey: portfolioKeys.features(id ?? ''),
    queryFn: async () => {
      const { data, error, response } = await apiClient.GET('/v1/portfolio-items/{id}/features', {
        params: { path: { id: id as string } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as PortfolioItem[] | undefined) ?? []
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}
