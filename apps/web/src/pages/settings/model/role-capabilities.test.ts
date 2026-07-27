import { describe, expect, it } from 'vitest'

import type { Role } from './use-system-roles'
import {
  cellFor,
  codesForState,
  editableState,
  holds,
  isBuiltInRole,
  permissionsFromStates,
  statesFor,
  statesFromRole,
} from './role-capabilities'

const role = (permissions: string[], over: Partial<Role> = {}): Role => ({
  id: 'r1',
  workspaceId: 'ws-1',
  name: 'Custom',
  slug: 'custom',
  description: null,
  isSystem: false,
  permissions,
  ...over,
})

describe('holds', () => {
  it('matches exact, namespace wildcard, and workspace wildcard', () => {
    expect(holds(role(['work_item:edit']), 'work_item:edit')).toBe(true)
    expect(holds(role(['work_item:*']), 'work_item:edit')).toBe(true)
    expect(holds(role(['workspace:*']), 'release:create')).toBe(true)
    expect(holds(role(['work_item:view']), 'work_item:edit')).toBe(false)
  })
})

describe('isBuiltInRole', () => {
  it('flags system and global roles', () => {
    expect(isBuiltInRole({ isSystem: true, workspaceId: 'ws-1' })).toBe(true)
    expect(isBuiltInRole({ isSystem: false, workspaceId: null })).toBe(true)
    expect(isBuiltInRole({ isSystem: false, workspaceId: 'ws-1' })).toBe(false)
  })
})

describe('cellFor vs editableState (openView)', () => {
  const teams = { label: 'Teams', manage: 'teams:create', openView: true }
  it('cellFor shows View for openView even with no codes; editableState does not', () => {
    expect(cellFor(role([]), teams)).toBe('view')
    expect(editableState(role([]), teams)).toBe('none')
    expect(cellFor(role(['teams:create']), teams)).toBe('full')
  })
})

describe('statesFor', () => {
  it('offers 3 states with both codes, 2 with one', () => {
    expect(statesFor({ label: 'x', view: 'a:view', manage: 'a:edit' })).toEqual([
      'none',
      'view',
      'full',
    ])
    expect(statesFor({ label: 'x', manage: 'a:edit' })).toEqual(['none', 'full'])
    expect(statesFor({ label: 'x', view: 'a:view' })).toEqual(['none', 'view'])
  })
})

describe('codesForState', () => {
  const row = { label: 'Sprints', view: 'iteration:view', manage: 'iteration:create' }
  it('full grants view+manage, view grants view, none grants nothing', () => {
    expect(codesForState(row, 'full')).toEqual(['iteration:view', 'iteration:create'])
    expect(codesForState(row, 'view')).toEqual(['iteration:view'])
    expect(codesForState(row, 'none')).toEqual([])
  })
})

describe('states ↔ permissions round-trip', () => {
  it('rebuilds the same editable states from the permissions it produced', () => {
    const original = role([
      'work_item:view',
      'work_item:create',
      'iteration:view',
      'audit:view',
    ])
    const states = statesFromRole(original)
    // Backlog full (view+create), Sprints view-only, Audit view.
    expect(states['Backlog & work items']).toBe('full')
    expect(states['Sprints']).toBe('view')
    expect(states['Audit log']).toBe('view')
    expect(states['Releases']).toBe('none')

    const perms = permissionsFromStates(states)
    // Re-deriving from the produced codes yields the same states.
    expect(statesFromRole(role(perms))).toEqual(states)
    expect(perms).toContain('work_item:create')
    expect(perms).toContain('iteration:view')
    expect(perms).not.toContain('iteration:create')
  })
})
