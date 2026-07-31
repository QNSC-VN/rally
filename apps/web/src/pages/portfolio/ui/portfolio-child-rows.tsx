/**
 * The child rows revealed under an expanded Portfolio row.
 *
 * Two levels, because the disclosure is the SAME affordance in both cases and only the
 * child shape differs (Rally's Portfolio Item tree):
 *   • an Epic discloses its child **Features**   → `usePortfolioChildFeatures`
 *   • a Feature discloses its linked **Stories / Defects** → `usePortfolioChildren`
 *
 * Modelled on Iteration Status' expanded child Tasks: the same shared
 * `RowExpandToggle` in the parent's ID cell, the same dashed child-row divider, the
 * same 2px hierarchy rail drawn as an INSET SHADOW rather than a left border — a
 * border would push every child cell 2px right and break alignment with the sticky
 * header. Child cells reuse the parent's `colStyleFor`, so resizing, reordering or
 * hiding a column moves the child cells with it for free.
 *
 * Mounted only while expanded, which is also what gates the fetch: both hooks are
 * `enabled` on a defined id, so an unmounted child list never queries. No page-level
 * expanded-id registry is needed.
 *
 * ── Why only ONE of the two levels edits inline ──────────────────────────────
 * A child **Feature** row is a full `PortfolioItemResponseDto`, identical to a top-level
 * row, so it edits through the same `useUpdatePortfolioItem` and the same shared cells —
 * matching Iteration Status, whose child Tasks are real work items and edit in place.
 *
 * A child **Story / Defect** row is `PortfolioChildResponseDto`, a DISPLAY PROJECTION:
 * it carries `ownerName` / `teamName` / `releaseName` and no corresponding ids, and
 * `scheduleState` as a bare string. A picker needs an id to bind its value to, so there
 * is nothing to bind — and a Story's fields belong to the work-items API, not the
 * portfolio one. Making that level editable needs the endpoint to return ids (or the row
 * to load the work item itself); it is not a stylistic choice. Open the Story via its ID
 * link to edit it meanwhile.
 */
import { useTranslation } from 'react-i18next'
import { type CSSProperties } from 'react'
import { useNavigate } from '@tanstack/react-router'

import {
  usePortfolioChildFeatures,
  usePortfolioChildren,
  useUpdatePortfolioItem,
  type PortfolioChild,
  type PortfolioItem,
  type PortfolioItemState,
} from '@/features/portfolio/api'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { ScheduleState, SCHEDULE_STATE_LABEL } from '@/entities/work-item/model/types'
import { PercentDoneBar } from '@/features/portfolio/ui/percent-done-bar'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { OwnerCell, OwnerSelectCell, type OwnerSelectMember } from '@/shared/ui/owner-cell'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { TeamCell } from '@/shared/ui/team-cell'
import { ProjectSelectCell, ReleaseSelectCell, TeamSelectCell } from './attribute-cells'
import { type PortfolioCellOptions, type ProjectOption } from '../model/cell-options'
import { RowGutter } from '@/shared/ui/row-gutter'
import { Spinner } from '@/shared/ui/spinner'
import { NESTED_ROW_INDENT } from '@/shared/config/layout'
import { useFieldCommit } from '@/shared/lib/hooks/use-field-commit'
import { type ColKey } from '../model/columns'
import { PORTFOLIO_STATES } from '../model/portfolio-states'

type ColStyleFor = (key: ColKey, base?: CSSProperties) => CSSProperties

/**
 * One child row shell — the leading gutter that makes the child's cells line up under
 * the parent's columns, then the caller's cells.
 *
 * Padding (`px-3`) and the gutter deliberately match `PortfolioRow` exactly; that pair
 * is what keeps a child cell under its own column heading. The dashed divider and
 * smaller type are the only intentional differences, marking the row as subordinate.
 */
function ChildRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center border-b border-dashed border-border-subtle px-3 text-ui-xs text-muted-foreground hover:bg-primary-lighter">
      {/* Mirrors the parent's gutter through the shared component (inert here — a child
          is not selectable and not rankable) so column 1 starts at the same x. */}
      <RowGutter dragDisabled />
      {children}
    </div>
  )
}

/**
 * A disclosed child Feature — the same row as a top-level Feature, one level in.
 *
 * Its own component (not a `.map()` body) because it owns a mutation hook: one
 * `useUpdatePortfolioItem` per row is what lets each row report its own success and
 * error, exactly as `PortfolioRow` and Iteration Status' `ChildTaskRow` do.
 */
function ChildFeatureRow({
  feature,
  colStyleFor,
  members,
  canEdit,
  options,
  projects,
  onOpen,
}: {
  feature: PortfolioItem
  colStyleFor: ColStyleFor
  members: OwnerSelectMember[]
  canEdit: boolean
  /** Release/Team options for THIS child's project, which may differ from its Epic's. */
  options: PortfolioCellOptions
  /** Move destinations, workspace-wide. */
  projects: ProjectOption[]
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation('portfolio')
  const update = useUpdatePortfolioItem()

  const { save: commit } = useFieldCommit(update)

  function save(patch: Parameters<typeof update.mutate>[0]['patch'], success: string) {
    commit({ id: feature.id, patch }, success)
  }

  return (
    <ChildRow>
      <div className={`flex items-center pr-2 ${NESTED_ROW_INDENT}`} style={colStyleFor('id')}>
        <IdCell type={feature.type} itemKey={feature.itemKey} onOpen={() => onOpen(feature.id)} />
      </div>

      <div
        className="min-w-0 px-0"
        style={colStyleFor('name')}
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditableCell
          fullCell
          value={feature.name}
          canEdit={canEdit}
          onCommit={(v) => {
            const next = v.trim()
            if (next && next !== feature.name) save({ name: next }, t('row.nameUpdated'))
          }}
          ariaLabel={t('columns.name')}
          title={feature.name}
          className="block w-full truncate text-foreground"
        />
      </div>

      <div
        className="min-w-0 px-0"
        style={colStyleFor('state')}
        onClick={(e) => e.stopPropagation()}
      >
        <SearchableSelect
          variant="cell"
          value={feature.state}
          readOnly={!canEdit}
          ariaLabel={t('filters.state')}
          options={PORTFOLIO_STATES.map((s) => ({ value: s, label: t(`states.${s}`) }))}
          onChange={(v) => {
            if (v && v !== feature.state)
              save({ state: v as PortfolioItemState }, t('row.stateUpdated'))
          }}
        />
      </div>

      <div
        className="flex min-w-0 items-center overflow-hidden px-0"
        style={colStyleFor('release')}
        onClick={(e) => e.stopPropagation()}
      >
        <ReleaseSelectCell
          releaseId={feature.releaseId}
          releaseName={feature.releaseName}
          releases={options.releases}
          canEdit={canEdit}
          ariaLabel={t('detail.fields.release')}
          onChange={(v) => {
            if (v !== feature.releaseId) save({ releaseId: v }, t('row.releaseUpdated'))
          }}
        />
      </div>

      {/* A child Feature carries its OWN rollup, so both progress bars are real here. */}
      <div className="min-w-0 px-2" style={colStyleFor('percentDonePoints')}>
        <PercentDoneBar
          metric="points"
          health={feature.health}
          progress={feature.progress}
          rollup={feature.rollup}
        />
      </div>
      <div className="min-w-0 px-2" style={colStyleFor('percentDoneCount')}>
        <PercentDoneBar
          metric="count"
          health={feature.health}
          progress={feature.progress}
          rollup={feature.rollup}
        />
      </div>

      <div
        className="flex min-w-0 items-center overflow-hidden px-0"
        style={colStyleFor('project')}
        onClick={(e) => e.stopPropagation()}
      >
        <ProjectSelectCell
          projectId={feature.projectId}
          projectName={feature.projectName}
          projects={projects}
          canEdit={canEdit}
          ariaLabel={t('detail.fields.project')}
          onChange={(v) => save({ projectId: v }, t('row.projectMoved'))}
        />
      </div>
      <div
        className="flex min-w-0 items-center overflow-hidden px-0"
        style={colStyleFor('team')}
        onClick={(e) => e.stopPropagation()}
      >
        <TeamSelectCell
          teamId={feature.teamId}
          teamName={feature.teamName}
          teams={options.teams}
          canEdit={canEdit}
          ariaLabel={t('detail.fields.team')}
          onChange={(v) => {
            if (v !== feature.teamId) save({ teamId: v }, t('row.teamUpdated'))
          }}
        />
      </div>

      <div
        className="min-w-0 overflow-hidden px-0"
        style={colStyleFor('owner')}
        onClick={(e) => e.stopPropagation()}
      >
        <OwnerSelectCell
          ownerName={feature.ownerName}
          assigneeId={feature.ownerId}
          members={members}
          canEdit={canEdit}
          ariaLabel={t('detail.fields.owner')}
          onChange={(v) => {
            if (v !== feature.ownerId) save({ ownerId: v }, t('row.ownerUpdated'))
          }}
        />
      </div>
    </ChildRow>
  )
}

/**
 * A disclosed Story / Defect — read-only, and see this module's header for why: the
 * endpoint returns display names without the ids a picker would bind to.
 */
function ChildWorkItemRow({
  child,
  colStyleFor,
  onOpen,
}: {
  child: PortfolioChild
  colStyleFor: ColStyleFor
  onOpen: (itemKey: string) => void
}) {
  const { t } = useTranslation('portfolio')

  return (
    <ChildRow>
      <div className={`flex items-center pr-2 ${NESTED_ROW_INDENT}`} style={colStyleFor('id')}>
        <IdCell type={child.type} itemKey={child.itemKey} onOpen={() => onOpen(child.itemKey)} />
      </div>
      <div className="min-w-0 px-2" style={colStyleFor('name')}>
        <span className="block truncate text-foreground" title={child.title}>
          {child.title}
        </span>
      </div>
      {/* Schedule state, not portfolio state — a Story lives on the work-item lifecycle,
          so it reads from the shared SCHEDULE_STATE_LABEL map. */}
      <div className="min-w-0 truncate px-2" style={colStyleFor('state')}>
        {SCHEDULE_STATE_LABEL[child.scheduleState as ScheduleState] ?? child.scheduleState}
      </div>
      <div
        className="flex min-w-0 items-center overflow-hidden px-0"
        style={colStyleFor('release')}
      >
        <ReleaseSelectCell
          releaseName={child.releaseName}
          releases={[]}
          canEdit={false}
          ariaLabel={t('detail.fields.release')}
          onChange={() => undefined}
        />
      </div>
      {/* Percent Done is a portfolio rollup — a single Story has none, so these stay
          empty rather than showing a 0% bar that would read as "no progress". */}
      <div className="px-2" style={colStyleFor('percentDonePoints')} />
      <div className="px-2" style={colStyleFor('percentDoneCount')} />
      <div className="min-w-0 truncate px-2" style={colStyleFor('project')}>
        {child.projectName ?? '--'}
      </div>
      <div className="min-w-0 px-2" style={colStyleFor('team')}>
        <TeamCell name={child.teamName} />
      </div>
      <div className="min-w-0 px-2" style={colStyleFor('owner')}>
        <OwnerCell name={child.ownerName} />
      </div>
    </ChildRow>
  )
}

export function PortfolioChildRows({
  item,
  colStyleFor,
  members,
  canEditProject,
  optionsFor,
  projects,
}: {
  item: PortfolioItem
  /** The parent grid's resolved per-column style, so child cells track column layout. */
  colStyleFor: ColStyleFor
  /** Workspace roster for the Owner picker, fetched once by the page. */
  members: OwnerSelectMember[]
  /**
   * Edit rights for a given project — resolved per CHILD, not inherited from the parent
   * row: a child Feature may sit in a different project than the Epic above it on this
   * cross-project grid.
   */
  canEditProject: (projectId: string) => boolean
  /** Release/Team options by project, resolved per child for the same reason. */
  optionsFor: (projectId: string) => PortfolioCellOptions
  /** Move destinations, workspace-wide. */
  projects: ProjectOption[]
}) {
  const { t } = useTranslation('portfolio')
  const navigate = useNavigate()
  const isEpic = item.type === 'epic'

  // Only one of the two fires: the other is handed `undefined` and stays disabled.
  const features = usePortfolioChildFeatures(isEpic ? item.id : undefined)
  const children = usePortfolioChildren(isEpic ? undefined : item.id)
  const { isLoading } = isEpic ? features : children

  const openPortfolioItem = (id: string) =>
    void navigate({ to: '/portfolio/$itemId', params: { itemId: id } })
  const openWorkItem = (itemKey: string) =>
    void navigate({ to: '/item/$itemKey', params: { itemKey } })

  const rows = isEpic
    ? (features.data ?? []).map((f) => (
        <ChildFeatureRow
          key={f.id}
          feature={f}
          colStyleFor={colStyleFor}
          members={members}
          canEdit={canEditProject(f.projectId)}
          options={optionsFor(f.projectId)}
          projects={projects}
          onOpen={openPortfolioItem}
        />
      ))
    : (children.data ?? []).map((c) => (
        <ChildWorkItemRow key={c.id} child={c} colStyleFor={colStyleFor} onOpen={openWorkItem} />
      ))

  return (
    <div className="bg-surface-hover shadow-[inset_2px_0_0_var(--primary-lighter)]">
      {isLoading ? (
        <div className="flex items-center gap-1.5 py-1.5 pl-11 text-ui-xs text-foreground-subtle">
          <Spinner size="sm" />
          {t('row.loadingChildren')}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-1.5 pl-11 text-ui-xs text-foreground-subtle">
          {isEpic ? t('row.noChildFeatures') : t('row.noChildItems')}
        </div>
      ) : (
        rows
      )}
    </div>
  )
}
