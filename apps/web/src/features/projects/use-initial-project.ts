/**
 * Somebody has to pick the FIRST project. Until this existed, nobody did.
 *
 * THE DEFECT: `app-context.store` starts with `project: null`, the shell renders "No project
 * selected", and every nav item and route guard resolves its permission against the SELECTED project
 * — so with none selected, a per-project Admin or Editor holds nothing. Their first sign-in showed
 * Home and Access Denied on every URL: the exact experience of a No Access principal, for a user who
 * had just been granted access. A Workspace Admin never saw it, because `workspace:*` grants
 * regardless of scope, which is why it survived to the day the BA asked for a non-admin login.
 *
 * THE BA IS SILENT on who chooses, so this is a declared design decision rather than a rule:
 *
 *   • keep the reader's own choice whenever it is still readable — zustand persists `project`, and
 *     overriding a deliberate selection on every mount would be worse than not choosing at all;
 *   • otherwise take the first ACTIVE project the list offers, which is the first row of the same
 *     picker the reader sees, so the selection is explicable from the screen;
 *   • and if the resolved list is EMPTY, select nothing. That is a genuine No Access principal and
 *     the shell's "No project selected" is the honest state — inventing a selection would be a
 *     claim about access we do not have.
 *
 * IT IS ALSO THE RECONCILER, and that is the half it was missing (GAP-P4-RBAC-003, AC5).
 * ---------------------------------------------------------------------------------------
 * `project` is PERSISTED zustand state, so it outlives the grant it was made under. When a Workspace
 * Admin removes a user's access to the only project they had, the next sign-in resolved an EMPTY
 * list — and the early `return` on that case left the revoked project SELECTED. Everything downstream
 * reads that value, so the shell's context trigger kept printing `TEST · All Teams`, the breadcrumb
 * kept naming the project, and every project-scoped query kept being issued for it: the "Unassigned
 * metadata leak" the BA retest reported, against SRS §2.2 ("an unassigned user cannot see the Project
 * in navigation, selectors, search or results") and §6.
 *
 * A revoked selection was already replaced when SOME other project remained — `active[0]` took over —
 * so the leak existed only for the reader with nothing left, which is exactly the No Access principal
 * the rule is about. The list is the authority either way: `GET /v1/projects` is scoped by
 * `AccessService.listReadableProjectIds`, so a project absent from a RESOLVED response is one the
 * server will not serve. Clearing is therefore not a guess — it is the server's answer applied to
 * client state, once, where every reader of that state benefits.
 *
 * `undefined` still decides nothing. A failed or in-flight list must not clear a good selection, for
 * the same reason it must not invent one.
 *
 * ONLY AFTER THE LIST RESOLVES. `data` is `undefined` both while loading and after a failure, and
 * acting on either would decide before the evidence arrived — the "state FROZEN before its source
 * arrived" shape `CLAUDE.md` records, where a draft materialised from a baseline that had not landed
 * and could never recover. A failed load must leave the previous selection alone.
 *
 * The Team is cleared when the project changes, exactly as the shell's own switcher does: a Team
 * belongs to the project being left.
 */
import { useEffect } from 'react'

import { useAppContext } from '@/shared/lib/stores/app-context.store'

/** The subset of a project row this needs. Matches `Project` from the list feed. */
export interface SelectableProject {
  id: string
  key: string
  name: string
  status: string
}

export function useInitialProject(projects: SelectableProject[] | undefined): void {
  const project = useAppContext((s) => s.project)
  const setProject = useAppContext((s) => s.setProject)
  const setTeam = useAppContext((s) => s.setTeam)

  useEffect(() => {
    // `undefined` = still loading, or failed. Neither is evidence.
    if (projects === undefined) return

    const active = projects.filter((p) => p.status === 'active')

    // The reader's own choice wins while it remains readable.
    if (project && active.some((p) => p.id === project.projectId)) return

    const next = active[0]
    if (!next) {
      // Nothing readable is left. DROP the stale selection rather than returning early: a persisted
      // project outlives its grant, and keeping it here is what kept `TEST · All Teams` on screen and
      // kept every project-scoped request being issued for a project the server refuses. `null` is
      // the honest state and the shell already renders it ("No project selected").
      if (project) {
        setProject(null)
        setTeam(null)
      }
      return
    }
    setProject({ projectId: next.id, projectKey: next.key, projectName: next.name })
    setTeam(null)
  }, [projects, project, setProject, setTeam])
}
