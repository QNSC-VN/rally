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
 * Only types the actor may view are offered, mirroring the per-type permissions
 * the Plan nav used to gate on (iteration:view / project:view / milestone:view).
 */
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { InlineSelect } from '@/shared/ui/native-select'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'

export type TimeboxType = 'iterations' | 'releases' | 'milestones'

const ROUTE: Record<TimeboxType, string> = {
  iterations: '/timeboxes',
  releases: '/releases',
  milestones: '/milestones',
}

/** Which permission each type requires to be offered — matches the old nav. */
const VIEW_PERMISSION: Record<TimeboxType, string> = {
  iterations: 'iteration:view',
  releases: 'project:view',
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
    <label className="flex items-center gap-1.5">
      <span className="text-ui-xs font-semibold tracking-widest text-foreground-subtle uppercase">
        {t('type.label')}
      </span>
      <InlineSelect
        aria-label={t('type.label')}
        value={current}
        onChange={(e) => {
          const next = e.target.value as TimeboxType
          if (next !== current) void navigate({ to: ROUTE[next] })
        }}
        className="min-w-[7.5rem]"
      >
        {types.map((type) => (
          <option key={type} value={type}>
            {t(`type.${type}`)}
          </option>
        ))}
      </InlineSelect>
    </label>
  )
}
