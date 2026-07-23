import { QueryClient } from '@tanstack/react-query'

import { createInvalidationMutationCache } from './invalidation'

/**
 * Shared TanStack Query client.
 * Defaults tuned per FRONTEND_STRUCTURE.md §6/§9 — background refetch is the
 * MVP "realtime" mechanism; staleTime is conservative and refined per-resource.
 *
 * Cache invalidation is centralised: the `mutationCache` below runs the
 * tag-based registry (see `invalidation.ts`) after every successful mutation,
 * so mutations declare WHAT they changed (`meta.invalidates`) rather than
 * hand-listing query keys in `onSuccess`.
 */
export const queryClient: QueryClient = new QueryClient({
  // The cache needs the client to invalidate; the client owns the cache — so we
  // hand the cache a lazy getter that resolves once `queryClient` is assigned.
  mutationCache: createInvalidationMutationCache(() => queryClient),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status
        if (status && status >= 400 && status < 500) return false
        return failureCount < 1
      },
      refetchOnWindowFocus: true,
    },
  },
})
