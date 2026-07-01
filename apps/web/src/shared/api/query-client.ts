import { QueryClient } from '@tanstack/react-query'

/**
 * Shared TanStack Query client.
 * Defaults tuned per FRONTEND_STRUCTURE.md §6/§9 — background refetch is the
 * MVP "realtime" mechanism; staleTime is conservative and refined per-resource.
 */
export const queryClient = new QueryClient({
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
