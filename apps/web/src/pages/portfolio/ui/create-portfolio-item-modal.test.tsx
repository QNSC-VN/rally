/**
 * `New Epic` / `New Feature`: the Project is auto-filled and READ-ONLY.
 *
 * P5 §4 spells the field "Project (auto-filled from the current Project context and read-only)", §45
 * makes it "read-only afterward for both Feature and Epic" and §339 repeats it for an Epic. It used
 * to be a searchable dropdown over every project the caller held `portfolio:create` on, with a
 * cascade that reset Team, Epic, Release and Owner on change — a reading of the older §66 wording
 * "Project (select, cascades Team)".
 *
 * The permission mock is deliberately an Admin of ONE project: if a picker ever comes back, the
 * caller has a second project it could legally be offered, so these tests would fail rather than
 * pass by having nothing to show.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}))
vi.mock('@/shared/lib/toast', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
  errorMessage: (e: unknown) => String(e),
}))

const createItem = vi.fn()

vi.mock('@/features/portfolio/api', () => ({
  useCreatePortfolioItem: () => ({ mutateAsync: createItem, isPending: false }),
  usePortfolioItems: () => ({ items: [], isLoading: false, isError: false, total: 0 }),
}))
vi.mock('@/features/workspaces/api', () => ({
  useWorkspaceMemberOptions: () => ({
    data: [{ userId: 'alice', displayName: 'Alice Smith', email: 'alice@qnsc.dev' }],
  }),
}))
vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: () => ({
    workspace: { workspaceId: 'ws-1', workspaceName: 'QNSC' },
    project: { projectId: 'p-nxp', projectKey: 'NXP', projectName: 'NextGen Platform' },
    team: null,
  }),
}))
vi.mock('@/shared/lib/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'alice' } }),
}))
vi.mock('../model/use-cell-options', () => ({
  usePortfolioCellOptions: () => () => ({
    releases: [],
    teams: [{ id: 'team-1', name: 'Team Alpha', key: 'TA' }],
  }),
}))
/**
 * The FIXED project, resolved from the id the caller passed.
 *
 * `@/features/projects/api` and `@/features/access/api` are deliberately NOT mocked: the modal no
 * longer imports either, because there is no option list to build and no `portfolio:create` filter
 * to build it with. A mock for a module the component does not use would keep passing after a
 * regression re-added the picker.
 */
vi.mock('@/shared/lib/deep-link-project', () => ({
  useRecordProject: (projectId: string | undefined) =>
    projectId === 'p-nxp'
      ? { projectId: 'p-nxp', projectKey: 'NXP', projectName: 'NextGen Platform' }
      : undefined,
}))

import '@/shared/i18n/i18n'
import { PortfolioItemType } from '@/entities/work-item/model/types'
import { CreatePortfolioItemModal } from './create-portfolio-item-modal'

beforeEach(() => {
  vi.clearAllMocks()
  createItem.mockResolvedValue({ id: 'fe-9' })
})

function open(type: PortfolioItemType = PortfolioItemType.Feature) {
  render(<CreatePortfolioItemModal projectId="p-nxp" type={type} onClose={vi.fn()} />)
}

describe('CreatePortfolioItemModal — Project is read-only (§4, §45, §339)', () => {
  it('names the active project, chip and all', () => {
    open()
    expect(screen.getByText('NXP')).toBeInTheDocument()
    expect(screen.getByText('NextGen Platform')).toBeInTheDocument()
  })

  it('renders no Project picker for a Feature', () => {
    open()
    // Owner and Team ARE pickers on this modal and answer to their labels, so asking the same of
    // Project is a real question. `Search` is the picker popover's own input placeholder.
    expect(screen.getByRole('button', { name: /Owner/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Project' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Project' })).toBeNull()
    expect(screen.queryByLabelText('Project')).toBeNull()
  })

  it('renders no Project picker for an Epic either — §339 states it separately', () => {
    open(PortfolioItemType.Epic)
    expect(screen.queryByRole('button', { name: 'Project' })).toBeNull()
    expect(screen.getByText('NextGen Platform')).toBeInTheDocument()
  })

  it('creates in the fixed project', async () => {
    open()
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'Payment retries' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createItem).toHaveBeenCalled())
    expect(createItem.mock.calls[0][0].projectId).toBe('p-nxp')
  })

  it('sends the same project from `Create with details`', async () => {
    open()
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'With details' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create with details' }))

    await waitFor(() => expect(createItem).toHaveBeenCalled())
    expect(createItem.mock.calls[0][0].projectId).toBe('p-nxp')
  })
})
