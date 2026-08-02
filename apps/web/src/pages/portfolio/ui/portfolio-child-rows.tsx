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
 * ── Both levels edit inline, through DIFFERENT APIs ──────────────────────────
 * Matching Iteration Status, where a disclosed child Task edits in place just like its
 * parent Story.
 *
 * A child **Feature** is a full `PortfolioItemResponseDto`, so it writes through
 * `useUpdatePortfolioItem` — the same hook and cells as a top-level row.
 *
 * A child **Story / Defect** is a work item, so it writes through `useUpdateWorkItem`.
 * That level used to be read-only because `PortfolioChildResponseDto` returned display
 * NAMES with no corresponding ids, leaving a picker nothing to bind its value to. The
 * joins were already in the query; only the names were selected. Surfacing
 * `projectId` / `releaseId` / `teamId` / `assigneeId` was the whole fix.
 *
 * Consequence worth knowing: the State column carries two vocabularies by depth —
 * portfolio state on a Feature, SCHEDULE state on a Story — and Percent Done stays empty
 * on a Story, because a single work item has no rollup of its own.
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
import {
  ScheduleState,
  SCHEDULE_STATE_LABEL,
  SCHEDULE_STATE_VALUES,
} from '@/entities/work-item/model/types'
import { PercentDoneBar } from '@/features/portfolio/ui/percent-done-bar'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { OwnerSelectCell, type OwnerSelectMember } from '@/shared/ui/owner-cell'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { ProjectSelectCell, ReleaseSelectCell, TeamSelectCell } from './attribute-cells'
import { type PortfolioCellOptions, type ProjectOption } from '../model/cell-options'
import { RowGutter } from '@/shared/ui/row-gutter'
import { Spinner } from '@/shared/ui/spinner'
import { NESTED_ROW_INDENT } from '@/shared/config/layout'
import { useFieldCommit } from '@/shared/lib/hooks/use-field-commit'
import { useUpdateWorkItem } from '@/features/work-items/api'
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
    // Height and type scale MATCH the parent row (`min-h-[34px]`, `text-ui-md`), not a
    // smaller variant. They diverged before, which made every editable control on a child
    // row visibly smaller than the identical control one row above — the inline-edit box
    // most obviously. Subordination is carried by the indent, the dashed divider and the
    // tinted rail; shrinking the controls as well just made them look like a different
    // component.
    <div
      // A stable hook for the AC-5 cap: "up to 5 linked items". Counting rendered rows is the only
      // way to assert a cap as a property rather than against a fixture's child count.
      data-child-preview-row=""
      className="flex min-h-[34px] items-center border-b border-dashed border-border-subtle px-3 text-ui-md text-muted-foreground hover:bg-primary-lighter"
    >
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
          className="block w-full break-words whitespace-normal text-foreground"
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
  members,
  canEdit,
  options,
  onOpen,
}: {
  child: PortfolioChild
  colStyleFor: ColStyleFor
  members: OwnerSelectMember[]
  canEdit: boolean
  options: PortfolioCellOptions
  onOpen: (itemKey: string) => void
}) {
  const { t } = useTranslation('portfolio')
  const update = useUpdateWorkItem(child.id)
  const { save: commit } = useFieldCommit(update)

  return (
    <ChildRow>
      <div className={`flex items-center pr-2 ${NESTED_ROW_INDENT}`} style={colStyleFor('id')}>
        <IdCell type={child.type} itemKey={child.itemKey} onOpen={() => onOpen(child.itemKey)} />
      </div>

      <div
        className="min-w-0 px-0"
        style={colStyleFor('name')}
        onClick={(e) => e.stopPropagation()}
      >
        <InlineEditableCell
          fullCell
          value={child.title}
          canEdit={canEdit}
          onCommit={(v) => {
            const next = v.trim()
            if (next && next !== child.title) commit({ title: next }, t('row.nameUpdated'))
          }}
          ariaLabel={t('columns.name')}
          title={child.title}
          className="block w-full break-words whitespace-normal text-foreground"
        />
      </div>

      {/* SCHEDULE state, not portfolio state — a Story lives on the work-item lifecycle.
          The column therefore carries two different vocabularies depending on the row's
          depth, which is why it is a picker on both: a stepper for the children (as
          Iteration Status uses) beside a select for the parents would read as two
          unrelated controls stacked in one column. */}
      <div
        className="min-w-0 px-0"
        style={colStyleFor('state')}
        onClick={(e) => e.stopPropagation()}
      >
        <SearchableSelect
          variant="cell"
          value={child.scheduleState}
          readOnly={!canEdit}
          ariaLabel={t('detail.fields.state')}
          options={SCHEDULE_STATE_VALUES.map((sc) => ({
            value: sc,
            label: SCHEDULE_STATE_LABEL[sc],
          }))}
          onChange={(v) => {
            if (v && v !== child.scheduleState)
              commit({ scheduleState: v as ScheduleState }, t('row.stateUpdated'))
          }}
        />
      </div>

      <div
        className="flex min-w-0 items-center overflow-hidden px-0"
        style={colStyleFor('release')}
        onClick={(e) => e.stopPropagation()}
      >
        <ReleaseSelectCell
          releaseId={child.releaseId}
          releaseName={child.releaseName}
          releases={options.releases}
          canEdit={canEdit}
          ariaLabel={t('detail.fields.release')}
          onChange={(v) => commit({ releaseId: v }, t('row.releaseUpdated'))}
        />
      </div>

      {/* Percent Done is a portfolio rollup — a single Story has none, so these stay
          empty rather than showing a 0% bar that would read as "no progress". */}
      <div className="px-2" style={colStyleFor('percentDonePoints')} />
      <div className="px-2" style={colStyleFor('percentDoneCount')} />

      <div className="min-w-0 px-2 break-words whitespace-normal" style={colStyleFor('project')}>
        {child.projectName ?? '--'}
      </div>

      <div
        className="flex min-w-0 items-center overflow-hidden px-0"
        style={colStyleFor('team')}
        onClick={(e) => e.stopPropagation()}
      >
        <TeamSelectCell
          teamId={child.teamId}
          teamName={child.teamName}
          teams={options.teams}
          canEdit={canEdit}
          ariaLabel={t('detail.fields.team')}
          onChange={(v) => commit({ teamId: v }, t('row.teamUpdated'))}
        />
      </div>

      <div
        className="min-w-0 overflow-hidden px-0"
        style={colStyleFor('owner')}
        onClick={(e) => e.stopPropagation()}
      >
        <OwnerSelectCell
          ownerName={child.ownerName}
          assigneeId={child.assigneeId}
          members={members}
          canEdit={canEdit}
          ariaLabel={t('detail.fields.owner')}
          onChange={(v) => commit({ assigneeId: v }, t('row.ownerUpdated'))}
        />
      </div>
    </ChildRow>
  )
}

/**
 * Rally's inline preview shows at most five linked items (SRS:61, FR-006, AC-5).
 *
 * A cap, not pagination: the disclosure answers "what is under here" at a glance, and the Children
 * tab is where the full, sortable, searchable list lives.
 */
const CHILD_PREVIEW_LIMIT = 5

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
    : (children.data ?? [])
        .slice(0, CHILD_PREVIEW_LIMIT)
        .map((c) => (
          <ChildWorkItemRow
            key={c.id}
            child={c}
            colStyleFor={colStyleFor}
            members={members}
            canEdit={canEditProject(c.projectId)}
            options={optionsFor(c.projectId)}
            onOpen={openWorkItem}
          />
        ))

  /**
   * How many linked items the preview is NOT showing.
   *
   * "If more than 5 items are linked, a static `+N more - see Children tab` line is shown; it is
   * not clickable" (SRS:61, FR-006, AC-5). A disclosure that listed every child turned a quick
   * peek into an unbounded list inside the grid — the Children tab is the place that pages.
   *
   * Only the Story/Defect preview is capped. An Epic's disclosure reveals its child FEATURES
   * (§11.3), which the BA does not cap, and a Feature count per Epic is bounded by planning
   * rather than by delivery volume.
   */
  const hiddenChildren = isEpic
    ? 0
    : Math.max(0, (children.data?.length ?? 0) - CHILD_PREVIEW_LIMIT)

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
        <>
          {rows}
          {hiddenChildren > 0 && (
            /* STATIC, and deliberately not a link: "it is not clickable" (AC-5). Making it one
               would offer a second route to the Children tab from a row whose own click target is
               the ID cell, and the BA is explicit that the preview navigates nowhere. */
            <div className="py-1.5 pl-11 text-ui-xs text-foreground-subtle">
              {t('row.morePreviewItems', { count: hiddenChildren })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
