/**
 * Release Tracking — a failed release feed is not an empty project.
 *
 * The audit's flagship instance of this defect class, and the sharpest one, because the fabricated
 * sentence comes with an instruction:
 *
 *   `const { data: releases = [] } = useReleases(projectId)` discarded `isError` AND `isLoading`,
 *   so a 500, a 403 or a cold load made `releases.length === 0` true and the RT §5.1 branch
 *   asserted *"No releases in this project — Create one under Plan > Timeboxes to track it here."*
 *
 * A fabricated fact plus a wrong call to action, from a network fault — directly under a code
 * comment quoting the requirement it violates. The reader's next move is to create a duplicate
 * release.
 *
 * i18n is not initialised under test, so `t('empty.noRelease.title')` renders the raw KEY. Assert
 * on the key rather than the English copy, which would make this a translation-file change
 * detector (the convention the other report tests already follow).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: () => ({ project: { projectId: 'p-1', projectKey: 'NXP' }, team: undefined }),
}))

vi.mock('@/features/teams/api', () => ({ useProjectTeams: () => ({ data: [] }) }))

// Both reads on the right-hand pane are stubbed absent: the query under test is the RELEASE FEED,
// and a report failing for its own reasons would confuse which sentence the assertions belong to.
const idle = { data: undefined, isLoading: false, isError: false }
vi.mock('@/features/reporting/api', () => ({
  useReleaseTracking: () => idle,
  useReleaseBurnup: () => idle,
}))

/**
 * The release feed, mutable per test. This is the query under test — everything else is stubbed so
 * the only variable is whether `/v1/releases` answered.
 */
const releaseFeed: {
  data?: { id: string; name: string; startDate: string | null; releaseDate: string | null }[]
  isLoading?: boolean
  isError?: boolean
  error?: unknown
} = { data: [] }
vi.mock('@/features/releases/api', () => ({ useReleases: () => releaseFeed }))

import { ReleaseTrackingPage } from './release-tracking-page'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<ReleaseTrackingPage />, { wrapper })
}

beforeEach(() => {
  localStorage.clear()
  releaseFeed.data = []
  releaseFeed.isLoading = false
  releaseFeed.isError = false
  releaseFeed.error = undefined
})

describe('ReleaseTrackingPage', () => {
  it('reports a FAILED release feed as a failure, and does NOT claim the project has no releases', async () => {
    releaseFeed.data = undefined
    releaseFeed.isError = true
    releaseFeed.error = new Error('500 Internal Server Error')
    renderPage()

    await waitFor(() => expect(screen.getByText('releaseFeedError.title')).toBeInTheDocument())
    // The fabricated fact AND the wrong call to action must both be absent, not accompanied.
    expect(screen.queryByText('empty.noRelease.title')).not.toBeInTheDocument()
    expect(screen.queryByText('empty.noRelease.description')).not.toBeInTheDocument()
  })

  it('still shows the §5.1 no-Release state when the server really answered with none', async () => {
    // Separating error from empty must not delete the requirement's own empty state.
    releaseFeed.data = []
    renderPage()

    await waitFor(() => expect(screen.getByText('empty.noRelease.title')).toBeInTheDocument())
    expect(screen.queryByText('releaseFeedError.title')).not.toBeInTheDocument()
  })

  it('claims nothing at all while the release feed is still in flight', () => {
    // A cold load used to render the no-Release state too — the same sentence, before any answer.
    releaseFeed.data = undefined
    releaseFeed.isLoading = true
    renderPage()

    expect(screen.queryByText('empty.noRelease.title')).not.toBeInTheDocument()
    expect(screen.queryByText('releaseFeedError.title')).not.toBeInTheDocument()
  })
})
