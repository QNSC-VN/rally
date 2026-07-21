import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TimeboxTypeSwitcher } from './timebox-type-switcher'

// The switcher's whole job is navigation + permission gating, so those two
// collaborators are the surface under test. i18n is stubbed to identity so the
// assertions read against stable option labels, not translation lookups.
const navigate = vi.fn()
let grants: Record<string, boolean>

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) =>
      (
        ({
          'type.label': 'Type',
          'type.iterations': 'Iterations',
          'type.releases': 'Releases',
          'type.milestones': 'Milestones',
        }) as Record<string, string>
      )[k] ?? k,
  }),
}))
vi.mock('@/shared/lib/stores/app-context.store', () => ({
  useAppContext: () => ({ project: { projectId: 'p1' } }),
}))
vi.mock('@/features/access/api', () => ({
  useProjectPermissions: () => ({ can: (code: string) => grants[code] ?? false }),
}))

const optionLabels = () =>
  Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => o.textContent)

describe('TimeboxTypeSwitcher', () => {
  beforeEach(() => {
    navigate.mockReset()
    grants = { 'iteration:view': true, 'project:view': true, 'milestone:view': true }
  })

  it('offers the three timebox types when the actor may view all', () => {
    render(<TimeboxTypeSwitcher current="iterations" />)
    expect(optionLabels()).toEqual(['Iterations', 'Releases', 'Milestones'])
    // Reflects the route it is on, so the control never shows a stale mode.
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('iterations')
  })

  it.each([
    ['releases', '/releases'],
    ['milestones', '/milestones'],
    ['iterations', '/timeboxes'],
  ])('navigates to %s → %s on change', (value, route) => {
    render(<TimeboxTypeSwitcher current={value === 'iterations' ? 'releases' : 'iterations'} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value } })
    expect(navigate).toHaveBeenCalledWith({ to: route })
  })

  it('does not navigate when the current type is re-selected', () => {
    render(<TimeboxTypeSwitcher current="releases" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'releases' } })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('hides a type the actor cannot view', () => {
    grants = { 'iteration:view': true, 'project:view': false, 'milestone:view': true }
    render(<TimeboxTypeSwitcher current="iterations" />)
    expect(optionLabels()).toEqual(['Iterations', 'Milestones'])
  })

  it('always keeps the current type visible even if its permission is missing', () => {
    // Guards against a permission race rendering a select with no matching value.
    grants = { 'iteration:view': false, 'project:view': false, 'milestone:view': false }
    render(<TimeboxTypeSwitcher current="releases" />)
    expect(optionLabels()).toEqual(['Releases'])
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('releases')
  })
})
