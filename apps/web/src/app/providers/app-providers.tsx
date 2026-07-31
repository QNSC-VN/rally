import { type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster } from 'sonner'
import { queryClient } from '@/shared/api/query-client'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* BOTTOM-right, not top-right: at the top a toast lands squarely on the detail header's
          controls — the plan page's `⋮` Actions menu and its close button sit there, and a
          confirmation of what you just did should not block the next thing you do. Nothing the app
          renders in the bottom-right corner is interactive. */}
      <Toaster position="bottom-right" toastOptions={{ classNames: { toast: 'text-ui-lg' } }} />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
