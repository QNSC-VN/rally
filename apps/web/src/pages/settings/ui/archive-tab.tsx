/**
 * Settings ▸ Workspace ▸ Archive — the place archived Projects and Teams exist.
 *
 * The defect this closes: archiving was a one-way door with no door on the other side. An archived
 * PROJECT survives in `GET /v1/projects` (the list carries every status) but every surface that reads
 * it filters to active, so outside the Projects grid's own Archived filter it was invisible; an
 * archived TEAM was invisible everywhere, for a reason worth writing down —
 *
 * **`useProjectTeams` (`GET /projects/:id/teams`) NARROWS to active teams SERVER-SIDE, on purpose.**
 * `ProjectTeamDrizzleRepository` filters `eq(teams.status, 'active')` with an inner join, because that
 * one query feeds every team picker AND the Capacity plan's Add Team dialog, whose write path requires
 * both the link and the team to be active and answers `CAPACITY_TEAM_NOT_FOUND` otherwise — a picker
 * offering what the server refuses was half of `P5-CP-006`. So the per-project Teams tab in
 * `project-teams-tab.tsx` renders a `Status` column and a Restore action that **can never fire**: the
 * archived rows it would act on are removed before the response is built. Do NOT "fix" that by
 * widening the narrowed feed — the fix is this tab, which reads the DIRECTORY feed instead
 * (`GET /workspaces/:id/teams?includeInactive=true`, `useWorkspaceTeams(id, true)`), the one read whose
 * audience is administrative rather than a picker's.
 *
 * Two more properties, both about not lying:
 *
 *  • **Emptiness is measured across BOTH populations at once.** "Nothing is archived" is one sentence,
 *    so two empty tables would be two half-answers to a question with one answer. A section renders
 *    only when it has rows.
 *  • **A failed read is not an empty archive.** `combinePhase` folds the two feeds and error wins over
 *    loading, so a 500 on either says so rather than inviting the reader to conclude nothing is
 *    archived — the class of defect `shared/lib/query/resource.ts` exists to prevent.
 *
 * Gated on `workspace:view` in `settings-page.tsx`, matching its sibling administrative entries
 * (`Workspace Settings`, `Audit Log`): `workspace:*` is admin-reserved, so this is Workspace Admin
 * alone, which is also who holds the `workspace:edit` and `teams:edit` the writes here require.
 */
import { useMemo } from 'react'
import { Archive } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useProjects } from '@/features/projects/api'
import { useWorkspaceTeams } from '@/features/teams/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { combinePhase, firstError, listResource } from '@/shared/lib/query/resource'
import { Card, CardBody, CardHeader } from '@/shared/ui/card'
import { EmptyState } from '@/shared/ui/empty-state'
import { LoadErrorState } from '@/shared/ui/load-error-state'
import { ArchivedProjectRow } from './archive/archived-project-row'
import { ArchivedTeamRow } from './archive/archived-team-row'
import { SettingsTabHeader } from './settings-tab-header'

export function ArchiveTab() {
  const { t } = useTranslation('settings')
  const workspaceId = useAppContext((s) => s.workspace?.workspaceId)

  // Bound to their own consts before `listResource`, per that module's note: the React Compiler
  // cannot see through a hook call used as a plain function's argument.
  const projectsQuery = useProjects(workspaceId)
  const teamsQuery = useWorkspaceTeams(workspaceId, true)
  const projects = listResource(projectsQuery)
  const teams = listResource(teamsQuery)

  const archivedProjects = useMemo(
    () => projects.rows.filter((p) => p.status === 'archived'),
    [projects.rows],
  )
  const archivedTeams = useMemo(
    () => teams.rows.filter((team) => team.status === 'archived'),
    [teams.rows],
  )

  const phase = combinePhase(projects, teams)
  const nothingArchived = archivedProjects.length === 0 && archivedTeams.length === 0

  return (
    <>
      <SettingsTabHeader
        contained
        title={t('nav.archive')}
        description={t('tabDescriptions.archive')}
      />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {phase === 'loading' ? (
            <p className="text-ui-sm text-foreground-subtle">{t('archive.loading')}</p>
          ) : phase === 'error' ? (
            <LoadErrorState
              error={firstError(projects, teams)}
              title={t('archive.loadError')}
              size="sm"
            />
          ) : nothingArchived ? (
            <EmptyState
              icon={<Archive size={22} className="text-border-strong" />}
              title={t('archive.emptyTitle')}
              description={t('archive.emptyDescription')}
            />
          ) : (
            <>
              {archivedProjects.length > 0 && (
                <Card>
                  <CardHeader title={t('archive.projectsTitle')} />
                  <CardBody className="p-0">
                    <ArchiveTable>
                      {archivedProjects.map((project) => (
                        <ArchivedProjectRow key={project.id} project={project} />
                      ))}
                    </ArchiveTable>
                  </CardBody>
                </Card>
              )}

              {archivedTeams.length > 0 && (
                <Card>
                  <CardHeader title={t('archive.teamsTitle')} />
                  <CardBody className="p-0">
                    <ArchiveTable>
                      {archivedTeams.map((team) => (
                        <ArchivedTeamRow key={team.id} team={team} />
                      ))}
                    </ArchiveTable>
                  </CardBody>
                </Card>
              )}

              <p className="text-ui-sm text-foreground-subtle">{t('archive.footnote')}</p>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** The shared column set — both populations answer the same four questions. */
function ArchiveTable({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('settings')
  return (
    <table className="w-full border-collapse text-ui-sm">
      <thead className="bg-surface-subtle">
        <tr className="text-left text-ui-xs text-foreground-subtle">
          <th className="px-3 py-2 font-semibold">{t('archive.colKey')}</th>
          <th className="px-3 py-2 font-semibold">{t('archive.colName')}</th>
          <th className="px-3 py-2 text-right font-semibold">{t('archive.colMembers')}</th>
          <th className="px-3 py-2 font-semibold">{t('archive.colUpdated')}</th>
          <th className="px-3 py-2" />
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}
