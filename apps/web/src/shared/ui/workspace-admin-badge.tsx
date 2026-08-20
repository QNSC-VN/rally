/**
 * `Workspace Admin` — what a Workspace Admin renders as in a PROJECT or TEAM member view,
 * instead of an access level.
 *
 * The BA's team-membership ruling requires it in both views ("must render with a Workspace Admin
 * badge in Project and Team member views — never as Admin or Editor"), and the reason is the half of
 * §2.1 that did NOT change: a Workspace Admin holds no `project_members` row, so `admin` / `editor`
 * is not merely the wrong label for them — it is a claim about a row that does not exist, and one
 * that a surface offering a level select would then try to write.
 *
 * Shared, and modelled on {@link AllTeamsChip} for the same reason that one is: it is the answer to
 * "what access does this person have here?" for a principal whose answer comes from somewhere other
 * than the column it appears in, and two screens wording that differently is the drift
 * `shared/config/access-levels.ts` was created to end. Reuses the existing `access.workspaceAdmin`
 * string, which `EffectiveAccessChip` and the My Permissions tab already print.
 */
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'

export function WorkspaceAdminBadge() {
  const { t } = useTranslation('settings')
  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1 rounded bg-primary-lighter px-1.5 py-0.5 text-ui-xs font-medium text-primary">
      <ShieldCheck size={11} /> {t('access.workspaceAdmin')}
    </span>
  )
}
