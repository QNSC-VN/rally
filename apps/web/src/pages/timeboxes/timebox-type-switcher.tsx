/**
 * Timeboxes TYPE switcher.
 *
 * The BA mockup (03_Mockup Design) puts a single "Timeboxes" screen under
 * Plan, with a TYPE dropdown — Iterations / Releases / Milestones — that swaps
 * the surface in place. Releases and Milestones are NOT their own Plan menu
 * entries; that was gap DEV-004 (DEV_HANDOFF.md: "Release management remains
 * under Plan > Timeboxes"; P3-REL-001: "Open Plan -> Timeboxes; select
 * Releases"). This component is that dropdown.
 *
 * The three routes stay addressable (/timeboxes, /releases, /milestones) — the
 * mockup's own breadcrumb reads "… › Plan › Timeboxes" for every mode, so the
 * routes are an implementation detail behind one logical screen. Switching TYPE
 * navigates between them.
 *
 * Only types the actor may open are offered, and each type is gated on the code
 * its OWN surface requires. Both halves of that used to be wrong (RBE-09 /
 * P23-08): `Releases` was gated on `project:view`, which every access level
 * holds, so an Editor was offered a type whose list endpoint requires
 * `release:view` and answered 403 the moment it was chosen — a gate chosen for
 * what was convenient rather than for what the action is. And `Iterations` was
 * gated on `iteration:view`, which every level also holds because Iteration
 * Status, the Backlog filter and Team Status all read the iteration list; §3.2
 * marks the whole `Plan > Timeboxes` surface Hidden for an Editor, so it takes
 * `timebox:view`. All three types are now Admin/WA-only, which is what §3.2
 * says for Iterations, Releases and Milestones alike.
 */
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { NativeSelect } from '@/shared/ui/native-select'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'

export type TimeboxType = 'iterations' | 'releases' | 'milestones'

const ROUTE: Record<TimeboxType, string> = {
  iterations: '/timeboxes',
  releases: '/releases',
  milestones: '/milestones',
}

/**
 * The permission each type's own surface requires. Keep these equal to the code the
 * type's LIST endpoint carries — that is the invariant the previous values broke.
 */
const VIEW_PERMISSION: Record<TimeboxType, string> = {
  iterations: 'timebox:view',
  releases: 'release:view',
  milestones: 'milestone:view',
}

export function TimeboxTypeSwitcher({ current }: { current: TimeboxType }) {
  const { t } = useTranslation('iterations')
  const navigate = useNavigate()
  const { project } = useAppContext()
  const { can } = useProjectPermissions(project?.projectId)

  const types = (Object.keys(ROUTE) as TimeboxType[]).filter(
    // Always keep the current type visible even if a permission race would hide
    // it, so the control never renders without its own selected value.
    (type) => type === current || can(VIEW_PERMISSION[type]),
  )

  return (
    <label className="flex items-center gap-2">
      <span className="text-ui-xs font-semibold tracking-wide text-foreground-subtle">
        {t('type.label')}
      </span>
      <NativeSelect
        aria-label={t('type.label')}
        value={current}
        onChange={(e) => {
          const next = e.target.value as TimeboxType
          if (next !== current) void navigate({ to: ROUTE[next] })
        }}
        className="h-8 min-w-[8rem] py-1 text-ui-sm"
      >
        {types.map((type) => (
          <option key={type} value={type}>
            {t(`type.${type}`)}
          </option>
        ))}
      </NativeSelect>
    </label>
  )
}
