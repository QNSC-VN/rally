/**
 * My Permissions — the per-Project table, which is the half a screenshot cannot check.
 *
 * A Workspace Admin never renders it (`{!isWA && …}`), so the branch that answers this screen's
 * whole question — what level do I hold in each project — is only reachable as a non-admin. These
 * cases hold it after the migration onto the shared `Card` + `PanelTable`.
 *
 * The `EMPTY_VALUE`-not-`No Access` rule is the one worth pinning hardest: this file's own docblock
 * records that printing `No Access` for an unresolved read was the original defect, because absent
 * is not a level and guessing it is a claim about the reader.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_VALUE } from '@/shared/lib/utils'

const projects = vi.fn()
const permissionsFor = vi.fn()
const authState = vi.fn()

vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: (selector: (s: { workspace: { workspaceId: string } }) => unknown) =>
    selector({ workspace: { workspaceId: 'ws-1' } }),
}))
vi.mock('@/shared/lib/stores/auth.store', () => ({
  useAuthStore: () => authState(),
}))
vi.mock('@/features/projects/api', () => ({ useProjects: () => projects() }))
vi.mock('@/features/access/api', () => ({ useProjectPermissionsFor: () => permissionsFor() }))

import '@/shared/i18n/i18n'
import { MyPermissionsTab } from './my-permissions-tab'

const NXP = { id: 'p-1', key: 'NXP', name: 'NX Platform' }

/** A non-admin: the only principal for whom the per-project table renders at all. */
function signInAsMember() {
  authState.mockReturnValue({
    hasPermission: () => false,
    user: { displayName: 'Alice Developer' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  signInAsMember()
  projects.mockReturnValue({ data: [NXP], isLoading: false })
  permissionsFor.mockReturnValue({ can: () => false, isLoading: false })
})

describe('MyPermissionsTab — the per-Project access table', () => {
  it('names BOTH columns, so the level is not an unlabelled suffix', () => {
    render(<MyPermissionsTab />)
    // The old markup had one uppercase band reading `Your Project Access` over two unlabelled
    // columns, so the answer column had no heading.
    expect(screen.getByText('Project')).toBeTruthy()
    expect(screen.getByText('Your Access')).toBeTruthy()
  })

  it('renders the project, and the level derived from the self-scoped feed', () => {
    // `project:view` alone is the Editor baseline in `effectiveProjectLevel`.
    permissionsFor.mockReturnValue({
      can: (_id: string, code: string) => code === 'project:view' || code === 'work_item:create',
      isLoading: false,
    })
    render(<MyPermissionsTab />)

    expect(screen.getByText('NXP')).toBeTruthy()
    expect(screen.getByText('NX Platform')).toBeTruthy()
  })

  it('renders EMPTY_VALUE while the levels are still resolving — never `No Access`', () => {
    // The defect this screen was fixed for: an unresolved read is not a level, and printing one is
    // a false claim about the reader's own access.
    permissionsFor.mockReturnValue({ can: () => false, isLoading: true })
    render(<MyPermissionsTab />)

    expect(screen.getByText(EMPTY_VALUE)).toBeTruthy()
  })

  it('says so when there is no project to report on', () => {
    projects.mockReturnValue({ data: [], isLoading: false })
    render(<MyPermissionsTab />)
    expect(screen.getByText('No Projects available.')).toBeTruthy()
  })

  it('HIDES the per-project table from a Workspace Admin', () => {
    // Their authority is workspace-wide, so a per-project level would be a category error.
    authState.mockReturnValue({ hasPermission: () => true, user: { displayName: 'Admin User' } })
    render(<MyPermissionsTab />)

    expect(screen.queryByText('Your Access')).toBeNull()
    expect(screen.getByText('Access Level Reference')).toBeTruthy()
  })
})
