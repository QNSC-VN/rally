import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@/shared/api/http-client', () => ({
  apiClient: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() },
}))

import { apiClient } from '@/shared/api/http-client'
import { BulkScheduleActions } from './bulk-schedule-bar'

const mockPATCH = apiClient.PATCH as ReturnType<typeof vi.fn>

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function wrap(node: ReactNode, qc = makeClient()) {
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>)
}

const RELEASES = [{ id: 'r1', name: 'REL-1: Alpha' }]
const ITERATIONS = [{ id: 'i1', name: 'IT-1: Sprint 1' }]

function renderBar(overrides: Partial<Parameters<typeof BulkScheduleActions>[0]> = {}) {
  const clearSelection = vi.fn()
  wrap(
    <BulkScheduleActions
      projectId="p1"
      selectedIds={new Set(['a', 'b'])}
      clearSelection={clearSelection}
      releases={RELEASES}
      iterations={ITERATIONS}
      canEdit
      {...overrides}
    />,
  )
  return { clearSelection }
}

describe('BulkScheduleActions', () => {
  beforeEach(() => {
    mockPATCH.mockReset()
    mockPATCH.mockResolvedValue({ data: { updated: 2 }, error: undefined })
  })

  it('bulk-assigns a Release to the selected items and clears the selection', async () => {
    const { clearSelection } = renderBar()

    fireEvent.change(screen.getByLabelText('Assign release to selected'), {
      target: { value: 'r1' },
    })

    await waitFor(() =>
      expect(mockPATCH).toHaveBeenCalledWith('/v1/work-items/bulk-release', {
        body: { projectId: 'p1', itemIds: ['a', 'b'], releaseId: 'r1' },
      }),
    )
    await waitFor(() => expect(clearSelection).toHaveBeenCalled())
  })

  it('bulk-assigns an Iteration to the selected items', async () => {
    renderBar()

    fireEvent.change(screen.getByLabelText('Assign iteration to selected'), {
      target: { value: 'i1' },
    })

    await waitFor(() =>
      expect(mockPATCH).toHaveBeenCalledWith('/v1/work-items/bulk-iteration', {
        body: { projectId: 'p1', itemIds: ['a', 'b'], iterationId: 'i1' },
      }),
    )
  })

  it('maps the "— Unschedule —" choice to a null releaseId', async () => {
    renderBar()

    fireEvent.change(screen.getByLabelText('Assign release to selected'), {
      target: { value: '__none__' },
    })

    await waitFor(() =>
      expect(mockPATCH).toHaveBeenCalledWith('/v1/work-items/bulk-release', {
        body: { projectId: 'p1', itemIds: ['a', 'b'], releaseId: null },
      }),
    )
  })

  it('renders nothing when the caller lacks edit permission', () => {
    renderBar({ canEdit: false })
    expect(screen.queryByLabelText('Assign release to selected')).toBeNull()
  })

  it('does not fire a mutation when the placeholder option is re-selected', () => {
    renderBar()
    fireEvent.change(screen.getByLabelText('Assign release to selected'), {
      target: { value: '' },
    })
    expect(mockPATCH).not.toHaveBeenCalled()
  })
})
