import { beforeEach, describe, expect, it } from 'vitest'

import { useAppContext } from './app-context.store'

describe('useAppContext store', () => {
  beforeEach(() => {
    useAppContext.getState().reset()
  })

  it('starts with empty workspace/project/team context', () => {
    const state = useAppContext.getState()
    expect(state.workspace).toBeNull()
    expect(state.project).toBeNull()
    expect(state.team).toBeNull()
  })

  it('sets and clears the selected project', () => {
    useAppContext.getState().setProject({
      projectId: 'p1',
      projectKey: 'NXP',
      projectName: 'NX Platform',
    })
    expect(useAppContext.getState().project?.projectKey).toBe('NXP')

    useAppContext.getState().setProject(null)
    expect(useAppContext.getState().project).toBeNull()
  })

  it('sets the selected team and reset() clears it', () => {
    useAppContext.getState().setTeam({ teamId: 'team-1', teamName: 'Team One' })
    expect(useAppContext.getState().team?.teamId).toBe('team-1')
    expect(useAppContext.getState().team?.teamName).toBe('Team One')

    useAppContext.getState().reset()
    expect(useAppContext.getState().team).toBeNull()
  })
})
