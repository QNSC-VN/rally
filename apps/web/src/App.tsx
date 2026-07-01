import { RouterProvider } from '@tanstack/react-router'
import { AppProviders } from '@/app/providers/app-providers'
import { router } from '@/app/router/router'
import { queryClient } from '@/shared/api/query-client'

export default function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} context={{ queryClient }} />
    </AppProviders>
  )
}
