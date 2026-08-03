import { type CSSProperties, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import {
  useUpdatePortfolioItem,
  type PortfolioItem,
  type PortfolioItemState,
} from '@/features/portfolio/api'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { OwnerSelectCell, type OwnerSelectMember } from '@/shared/ui/owner-cell'
import { PercentDoneBar } from '@/features/portfolio/ui/percent-done-bar'
import { InlineEditableCell } from '@/shared/ui/inline-editable-cell'
import { RowGutter } from '@/shared/ui/row-gutter'
import { RowExpandToggle } from '@/shared/ui/row-expand-toggle'
import { BRAND } from '@/shared/config/brand'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { useFieldCommit } from '@/shared/lib/hooks/use-field-commit'
import { type ColKey } from '../model/columns'
import { PORTFOLIO_STATES } from '../model/portfolio-states'
import { hasChildren } from '../model/children'
import { PortfolioChildRows } from './portfolio-child-rows'
import { ProjectSelectCell, ReleaseSelectCell, TeamSelectCell } from './attribute-cells'
import { type PortfolioCellOptions, type ProjectOption } from '../model/cell-options'

/**
 * One Portfolio grid row.
 *
 * EVERY writable field edits in place, each through the shared cell for its attribute
 * type: Name, State, Epic, Release, Team, Owner, Preliminary Estimate and Refined
 * Estimate. `canEdit` is decided per ROW rather than per page: this list is
 * cross-project, so the answer differs between rows and a page-level flag would either
 * hide actions the user has elsewhere or offer ones they do not.
 *
 * What is NOT editable, and why — both are constraints, not omissions:
 *   • **Project** — `PATCH /v1/portfolio-items/{id}` carries no `projectId`, and moving
 *     an item would also have to clear its Epic, Release and Team, which all belong to
 *     the old project. That is an operation, not a field edit; no endpoint offers it.
 *   • **Percent Done ×2** — derived server-side from child rollups. There is nothing to
 *     write; you change them by accepting child work.
 *
 * Epic, Release and Team read as empty on an Epic ROW and offer no picker: all three are
 * Feature-only by CHECK constraint, so a write there is one the database refuses.
 *
 * Every attribute column renders through the SHARED cell for its attribute type rather
 * than a local `<span>` — the Backlog's `SearchableSelect` cell for the Release, the
 * square chip for the Team, `OwnerSelectCell` for the person. A span per column is how a grid drifts: the glyph,
 * the truncation, the disabled-dash colour and the link affordance all have to match the
 * other 8 grids, and only the shared component guarantees that.
 *
 * The row owns its dnd-kit wiring (`useSortable`) and therefore renders its OWN
 * `RowGutter` from the scaffold's `gutterProps` — only the row holds the activator ref
 * and drag listeners, so the scaffold's ready-made `gutter` node cannot carry them.
 */
export function PortfolioRow({
  item,
  canEdit,
  canRank,
  members,
  canEditProject,
  options,
  optionsFor,
  projects,
  revealed = false,
  colStyleFor,
  gutterProps,
  onOpen,
}: {
  item: PortfolioItem
  /** Highlighted because the user was just sent here — see the scaffold's `revealRowId`. */
  revealed?: boolean
  canEdit: boolean
  /** Workspace roster for the Owner picker; fetched once by the page, not per row. */
  members: OwnerSelectMember[]
  /**
   * Edit rights for an arbitrary project, for the DISCLOSED child rows. `canEdit` above
   * answers only for this row's own project; a child Feature may sit in another one on
   * this cross-project grid, so the children need the lookup rather than the answer.
   */
  canEditProject: (projectId: string) => boolean
  /** Epic/Release/Team options for THIS row's project. */
  options: PortfolioCellOptions
  /** Move destinations — workspace-wide, since a move targets a DIFFERENT project. */
  projects: ProjectOption[]
  /** The same lookup by project, for the disclosed child rows. */
  optionsFor: (projectId: string) => PortfolioCellOptions
  /** Drag-to-rank enabled: requires edit rights AND natural rank order. */
  canRank: boolean
  colStyleFor: (key: ColKey, base?: CSSProperties) => CSSProperties
  /** Gutter configuration from the list scaffold; the row renders the gutter itself. */
  gutterProps: {
    stopPropagation: true
    checkbox?: { checked: boolean; onChange: () => void; ariaLabel: string }
  }
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation('portfolio')
  const { progress, rollup } = item
  const update = useUpdatePortfolioItem()
  /**
   * Disclosure state, held per ROW rather than as a page-level id set.
   *
   * The child list is only mounted while open, and both child queries are `enabled` on a
   * defined id, so "closed" already means "not fetched" — a registry in the page would
   * add a second source of truth for the same fact. Same shape as Iteration Status.
   */
  const [expanded, setExpanded] = useState(false)
  const expandable = hasChildren(item)
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  // Shared commit helper: fire the mutation with the standard success/error toasts.
  const { save: commit } = useFieldCommit(update)

  function save(patch: Parameters<typeof update.mutate>[0]['patch'], success: string) {
    commit({ id: item.id, patch }, success)
  }

  return (
    <>
      <div
        ref={setNodeRef}
        className="group flex min-h-[34px] items-center border-b border-border-inner px-3 text-ui-md transition-colors hover:bg-primary-lighter"
        // Named so a test can find the row the user was just sent to, and so a screen reader is
        // not told about a purely visual hint.
        data-revealed={revealed || undefined}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          // The highlight loses to a drag: while dragging, THAT is what the row is doing.
          backgroundColor: isDragging
            ? BRAND.primaryLighter
            : revealed
              ? BRAND.accentBg
              : undefined,
          opacity: isDragging ? 0.6 : 1,
          // Lift the dragged row above its neighbours so it is not clipped mid-drag.
          zIndex: isDragging ? 1 : undefined,
          position: isDragging ? 'relative' : undefined,
        }}
        /**
         * An explicit handle for tests, instead of `[aria-roledescription="sortable"]`.
         *
         * dnd-kit's `attributes` now live on the grip, where the activator is — so that attribute
         * describes the grip and no longer marks the row. Three Playwright specs were locating rows
         * through it, which is why they broke: a test should not depend on where a drag library happens
         * to put its ARIA. This says "row", and means it regardless of the library.
         */
        data-portfolio-row={item.id}
      >
        <RowGutter
          ref={setActivatorNodeRef}
          dragListeners={listeners}
          dragAttributes={attributes}
          dragDisabled={!canRank}
          {...gutterProps}
        />

        {/* ID — the disclosure chevron sits to the LEFT of the type glyph (Rally parity,
          same placement as Iteration Status), then the same TypeBadge + key cell as
          US/DE/RE carrying EP-/FE-. A row with nothing to disclose gets a same-width
          spacer instead of a dead chevron, so every ID cell still starts at one x. */}
        <div
          style={colStyleFor('id', { flexShrink: 0 })}
          className="flex items-center gap-1.5 px-2"
        >
          {expandable ? (
            <RowExpandToggle
              expanded={expanded}
              onToggle={() => setExpanded(!expanded)}
              label={
                expanded
                  ? t(item.type === 'epic' ? 'row.collapseFeatures' : 'row.collapseItems')
                  : t(item.type === 'epic' ? 'row.expandFeatures' : 'row.expandItems')
              }
            />
          ) : (
            <span className="w-3 shrink-0" aria-hidden />
          )}
          <IdCell type={item.type} itemKey={item.itemKey} onOpen={() => onOpen(item.id)} />
        </div>

        <div
          style={colStyleFor('name', { flexShrink: 0 })}
          className="min-w-0 px-0"
          onClick={(e) => e.stopPropagation()}
        >
          <InlineEditableCell
            fullCell
            value={item.name}
            canEdit={canEdit}
            onCommit={(v) => {
              const next = v.trim()
              if (next && next !== item.name) save({ name: next }, t('row.nameUpdated'))
            }}
            ariaLabel={t('columns.name')}
            title={item.name}
            className="block w-full break-words whitespace-normal text-foreground"
          />
        </div>

        <div
          style={colStyleFor('state', { flexShrink: 0 })}
          className="min-w-0 px-0"
          onClick={(e) => e.stopPropagation()}
        >
          <SearchableSelect
            variant="cell"
            value={item.state}
            readOnly={!canEdit}
            ariaLabel={t('filters.state')}
            options={PORTFOLIO_STATES.map((s) => ({ value: s, label: t(`states.${s}`) }))}
            onChange={(v) => {
              if (v && v !== item.state)
                save({ state: v as PortfolioItemState }, t('row.stateUpdated'))
            }}
          />
        </div>

        {/* Release — the Backlog's release cell (glyph + `RE-1: name`). */}
        <div
          style={colStyleFor('release', { flexShrink: 0 })}
          className="flex min-w-0 items-center overflow-hidden px-0"
          onClick={(e) => e.stopPropagation()}
        >
          <ReleaseSelectCell
            releaseId={item.releaseId}
            releaseName={item.releaseName}
            releases={options.releases}
            canEdit={canEdit && item.type !== 'epic'}
            ariaLabel={t('detail.fields.release')}
            onChange={(v) => {
              if (v !== item.releaseId) save({ releaseId: v }, t('row.releaseUpdated'))
            }}
          />
        </div>

        {/* Percent Done by Plan Estimate — accepted points over rolled-up points.
          Coloured by the item's Rally status, not by the ratio: see PercentDoneBar. */}
        <div style={colStyleFor('percentDonePoints', { flexShrink: 0 })} className="min-w-0 px-2">
          <PercentDoneBar
            metric="points"
            health={item.health}
            progress={progress}
            rollup={rollup}
          />
        </div>

        {/* Percent Done by Count — accepted children over total children. */}
        <div style={colStyleFor('percentDoneCount', { flexShrink: 0 })} className="min-w-0 px-2">
          <PercentDoneBar metric="count" health={item.health} progress={progress} rollup={rollup} />
        </div>

        {/* Project — a MOVE, not a field edit: the server resets Team and drops a Release
          or Epic belonging to the old project. SRS §3.1 requires it editable. */}
        <div
          style={colStyleFor('project', { flexShrink: 0 })}
          className="flex min-w-0 items-center overflow-hidden px-0"
          onClick={(e) => e.stopPropagation()}
        >
          <ProjectSelectCell
            projectId={item.projectId}
            projectName={item.projectName}
            projects={projects}
            canEdit={canEdit}
            ariaLabel={t('detail.fields.project')}
            onChange={(v) => save({ projectId: v }, t('row.projectMoved'))}
          />
        </div>

        {/* Team — square key-chip + name (circle = person, square = team). Picker over the
          teams LINKED to this project: an unlinked team is not a legal assignment. */}
        <div
          style={colStyleFor('team', { flexShrink: 0 })}
          className="flex min-w-0 items-center overflow-hidden px-0"
          onClick={(e) => e.stopPropagation()}
        >
          <TeamSelectCell
            teamId={item.teamId}
            teamName={item.teamName}
            teams={options.teams}
            canEdit={canEdit && item.type !== 'epic'}
            ariaLabel={t('detail.fields.team')}
            onChange={(v) => {
              if (v !== item.teamId) save({ teamId: v }, t('row.teamUpdated'))
            }}
          />
        </div>

        {/* Owner — the shared person cell: searchable member picker when the caller may
          edit THIS row's project, initials chip + name when not. Same component as
          Iteration Status / Team Status / Projects. */}
        <div
          style={colStyleFor('owner', { flexShrink: 0 })}
          className="min-w-0 overflow-hidden px-0"
          onClick={(e) => e.stopPropagation()}
        >
          <OwnerSelectCell
            ownerName={item.ownerName}
            assigneeId={item.ownerId}
            members={members}
            canEdit={canEdit}
            ariaLabel={t('detail.fields.owner')}
            onChange={(v) => {
              if (v !== item.ownerId) save({ ownerId: v }, t('row.ownerUpdated'))
            }}
          />
        </div>
      </div>

      {/* Children — an Epic discloses its Features, a Feature its Stories/Defects. A
          SIBLING of the row, not a descendant: the row is the dnd-kit sortable node, so
          nesting the children inside it would drag them with the parent. */}
      {expanded && (
        <PortfolioChildRows
          item={item}
          colStyleFor={colStyleFor}
          members={members}
          canEditProject={canEditProject}
          optionsFor={optionsFor}
          projects={projects}
        />
      )}
    </>
  )
}
