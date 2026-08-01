import { useCallback, useMemo } from 'react'

import { useReleasesForProjects } from '@/features/releases/api'
import { useWorkspaceTeams } from '@/features/teams/api'
import { NO_CELL_OPTIONS, type PortfolioCellOptions } from './cell-options'

/**
 * The Release / Team options each grid row may choose from, keyed by PROJECT.
 *
 * A Feature's Release and Team must belong to the Feature's own project, and this list can
 * be opened up to every project — so a single workspace-wide union would offer targets the
 * API rejects. Both lists are therefore resolved per project and the row asks for its own.
 *
 * Where each list comes from, and why that source:
 *
 * - **Releases** — `useReleasesForProjects`, which already exists for exactly this shape
 *   of problem (one query per DISTINCT project, deduped, sharing `releaseKeys.list` with
 *   the single-project hook). The page already fans out one request per distinct project
 *   for permissions, so this is the same order of magnitude, not a new one. Grouping by
 *   `projectId` is what turns its flat union back into per-project lists.
 *
 * - **Teams** — ONE `useWorkspaceTeams` call, not a fan-out. Teams are workspace
 *   entities that are LINKED to projects, and the workspace response carries each team's
 *   `projects` links, so the per-project list is a client-side filter over one payload.
 *   Filtering matters: an unlinked team is not a legal assignment, so a workspace-wide
 *   list would offer invalid targets.
 *
 * (An Epic option list used to live here too, for a parent picker in the grid. BA spec
 * FR-002 has no Epic column, so both the picker and its query are gone — that query drained
 * every Epic in the workspace to populate a cell the spec never asked for.)
 *
 * All three are `staleTime`-cached and none of them block a row from rendering: a row
 * whose project has not resolved yet gets empty lists, which reads as "no options yet"
 * rather than as an error.
 */
export function usePortfolioCellOptions(
  workspaceId: string | undefined,
  projectIds: readonly string[],
) {
  const { data: teams = [] } = useWorkspaceTeams(workspaceId)
  const { data: releases } = useReleasesForProjects(projectIds)

  const releasesByProject = useMemo(() => {
    const map = new Map<string, PortfolioCellOptions['releases']>()
    for (const r of releases) {
      const list = map.get(r.projectId) ?? []
      list.push({ id: r.id, releaseKey: r.releaseKey, name: r.name })
      map.set(r.projectId, list)
    }
    return map
  }, [releases])

  const teamsByProject = useMemo(() => {
    const map = new Map<string, PortfolioCellOptions['teams']>()
    for (const tm of teams) {
      for (const link of tm.projects ?? []) {
        const list = map.get(link.projectId) ?? []
        list.push({ id: tm.id, name: tm.name, key: tm.key })
        map.set(link.projectId, list)
      }
    }
    return map
  }, [teams])

  return useCallback(
    (projectId: string): PortfolioCellOptions => {
      const releaseList = releasesByProject.get(projectId)
      const teamList = teamsByProject.get(projectId)
      if (!releaseList && !teamList) return NO_CELL_OPTIONS
      return { releases: releaseList ?? [], teams: teamList ?? [] }
    },
    [releasesByProject, teamsByProject],
  )
}
