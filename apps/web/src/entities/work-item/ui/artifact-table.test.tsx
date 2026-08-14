/**
 * Artifacts — a failed read must not say the release/milestone has nothing linked.
 *
 * This is the zero-row branch behind BOTH Artifacts tabs, and it is the defect the audit found
 * twice: the tab printed "No artifacts linked to this release" for every record in the system,
 * because the release endpoint's query DTO required a `projectId` the client never sent, so
 * **every request was a 400**. Nobody noticed for as long as the state existed, because an empty
 * artifacts list is a completely ordinary thing for a release to have.
 *
 * The NEGATIVE assertion is what makes this test worth writing: the fabricated sentence must be
 * ABSENT, not merely accompanied by an error.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { listResource } from '@/shared/lib/query/resource'
import { ArtifactTable, type ArtifactTableItem } from './artifact-table'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  useNavigate: () => vi.fn(),
}))

const ITEM: ArtifactTableItem = {
  id: 'w-1',
  itemKey: 'US-1',
  type: 'story',
  title: 'Wire the picker',
  scheduleState: 'in-progress',
  priority: 'high',
  assigneeName: 'Marcus Webb',
  storyPoints: 3,
}

function renderTable(q: {
  data: ArtifactTableItem[] | undefined
  isLoading?: boolean
  isError?: boolean
  error?: unknown
}) {
  return render(
    <ArtifactTable
      artifacts={listResource(q)}
      search=""
      entityNoun="release"
      startIndex={0}
      onOpenItem={() => {}}
    />,
  )
}

describe('ArtifactTable', () => {
  it('renders an ERROR and NOT "No artifacts linked to this release" when the query failed', () => {
    renderTable({ data: undefined, isError: true, error: new Error('400 Bad Request') })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Could not load this data.')).toBeInTheDocument()
    expect(screen.queryByText('No artifacts linked to this release')).not.toBeInTheDocument()
  })

  it('renders "No artifacts linked to this release" only when the server answered with nothing', () => {
    renderTable({ data: [], isLoading: false })

    expect(screen.getByText('No artifacts linked to this release')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the rows when there are rows', () => {
    renderTable({ data: [ITEM], isLoading: false })

    expect(screen.getByText('Wire the picker')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
