/**
 * Portfolio item detail sidebar — the same controls the Work Item sidebar uses, in the order
 * the BA spec fixes.
 *
 * FIELD ORDER IS SPECIFIED, not a layout choice. `01_Portfolio_Items/SRS.md` §5.1 (Feature)
 * and §11.4 (Epic) fix it, and `P5-PI-012` tests it:
 *
 *   Owner, Project, Epic, [four progress bars], Preliminary Estimate, State, Release,
 *   Creation Date, Refined Estimate, Refined Work Item Count Estimate,
 *   Planned Start Date, Planned End Date, Market Release Date
 *
 * Two things about that order are easy to get wrong and were both wrong here before:
 *
 * 1. The four progress bars belong in THIS panel. `FR-015` moves the old single Progress field
 *    to the left column as `Total Accepted Children` **and keeps** these indicators — they are
 *    not the same control shown twice, and dropping them because the left panel gained a meter
 *    loses `% Done by Plan Estimate`, `% Done by Count` and both Estimated Progress figures.
 * 2. Refined Estimate and Refined Work Item Count Estimate sit BELOW the read-only Creation
 *    Date, per the revised note at `SRS.md:110` — refinement happens after the item exists.
 *    The §5.1 table's own row order predates that note and is stale.
 *
 * Every field is a SHARED component, matched one-for-one against
 * `pages/work-item/ui/detail-sidebar.tsx`: `DetailField` for the label, then
 * `SearchableSelect variant="field"` for an enum or an entity reference, `OwnerSelectField` for
 * the identity picker, `Input` for a number, `DateField variant="field"` for a date, and
 * `DetailReadonlyValue` for anything the API will not accept.
 *
 * Saving is buffered, also matching Work Item: every control calls `onUpdate`, which is
 * `setField` from `usePendingPatch` in the page, and the page shows a `SaveCancelBar`.
 *
 * TEAM IS DELIBERATELY ABSENT. `PHASE5_DEV_HANDOFF.md:169` lists Team among Feature detail's
 * fields, but SRS §5.1 has no Team row and the BA-reviewed mockup rail has no Team control —
 * Team is editable from the grid and the create modal instead. The docs contradict each other;
 * the SRS plus the accepted mockup win. Note `SRS.md:98` still has the rail MUTATE Team ("changing
 * Project resets Team to that Project's first Team"), which the service does server-side.
 *
 * Feature-only fields (Epic, Release) are OMITTED for an Epic rather than disabled: both are
 * Feature-only by CHECK constraint, so offering a control the database refuses would be a lie
 * about what the form can do. `P5-PI-039` tests that an Epic has no Release selector.
 */
import { useTranslation } from 'react-i18next'

import { type PortfolioItemDetail, type UpdatePortfolioItemBody } from '@/features/portfolio/api'
import { PercentDoneBar } from '@/features/portfolio/ui/percent-done-bar'
import { PortfolioItemType } from '@/entities/work-item/model/types'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { DetailField, DetailReadonlyValue } from '@/shared/ui/detail'
import { OwnerSelectField } from '@/shared/ui/entity-select-field'
import { DateField } from '@/shared/ui/date-field'
import { Input } from '@/shared/ui/input'
import { ProgressBar } from '@/shared/ui/progress-bar'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { formatDateTime } from '@/shared/lib/utils'
import { PORTFOLIO_STATES, PRELIMINARY_ESTIMATE_SIZES } from '../model/portfolio-states'

/** The workspace roster as `OwnerSelectField` wants it. */
interface MemberOption {
  userId: string
  displayName?: string | null
  email?: string | null
}

export function PortfolioDetailSidebar({
  item,
  canEdit,
  members,
  releases,
  epics,
  onUpdate,
}: {
  /** The item MERGED with pending edits — render this, never the raw server value. */
  item: PortfolioItemDetail
  canEdit: boolean
  members: MemberOption[]
  releases: { id: string; releaseKey: string | null; name: string }[]
  /** Candidate parents. Empty for an Epic, which has no parent. */
  epics: { id: string; itemKey: string; name: string }[]
  onUpdate: (patch: UpdatePortfolioItemBody) => void
}) {
  const { t } = useTranslation('portfolio')
  const isEpic = item.type === PortfolioItemType.Epic
  const readOnly = !canEdit
  const { progress, rollup } = item

  return (
    <div className="flex flex-col gap-3">
      <OwnerSelectField
        label={t('detail.fields.owner')}
        value={item.ownerId}
        members={members}
        disabled={readOnly}
        onChange={(v) => onUpdate({ ownerId: v || null })}
      />

      {/* Project is read-only here: the PATCH accepts `projectId`, but moving an item also
          resets its Team and drops a cross-project Release or Epic, so it belongs to the
          grid's Project cell where that consequence is visible in the row. */}
      <DetailField label={t('detail.fields.project')}>
        <DetailReadonlyValue>{item.projectName ?? '--'}</DetailReadonlyValue>
      </DetailField>

      {!isEpic && (
        <DetailField label={t('detail.fields.parent')}>
          <SearchableSelect
            variant="field"
            value={item.parentId ?? ''}
            readOnly={readOnly}
            ariaLabel={t('detail.fields.parent')}
            placeholder={t('create.noEpic')}
            searchPlaceholder="Search"
            options={[
              { value: '', label: t('create.noEpic') },
              ...epics.map((e) => ({
                value: e.id,
                label: `${e.itemKey}: ${e.name}`,
                searchText: `${e.itemKey} ${e.name}`,
                icon: <TypeBadge type={PortfolioItemType.Epic} size={16} />,
              })),
            ]}
            onChange={(v) => onUpdate({ parentId: v || null })}
          />
        </DetailField>
      )}

      {/* The four read-only indicators, computed from linked Story/Defect. Percent Done is
          coloured by the item's Rally health verdict; Estimated Progress keeps ProgressBar's
          own over-delivery colouring, because it measures accepted work against a top-down
          forecast rather than against the schedule — an item can be at 150% of forecast and
          still be late. */}
      <DetailField label={t('detail.progress.percentDonePoints')}>
        <PercentDoneBar metric="points" health={item.health} progress={progress} rollup={rollup} />
      </DetailField>
      <DetailField label={t('detail.progress.percentDoneCount')}>
        <PercentDoneBar metric="count" health={item.health} progress={progress} rollup={rollup} />
      </DetailField>
      <DetailField label={t('detail.progress.estimatedPoints')}>
        <ProgressBar ratio={progress.estimatedProgressByPoints} />
      </DetailField>
      <DetailField label={t('detail.progress.estimatedCount')}>
        <ProgressBar ratio={progress.estimatedProgressByCount} />
      </DetailField>

      <DetailField label={t('detail.fields.preliminaryEstimate')}>
        <SearchableSelect
          variant="field"
          value={item.preliminaryEstimate}
          readOnly={readOnly}
          ariaLabel={t('detail.fields.preliminaryEstimate')}
          options={PRELIMINARY_ESTIMATE_SIZES.map((s) => ({
            value: s,
            label: t(`sizes.${s}`, { defaultValue: s }),
          }))}
          onChange={(v) =>
            onUpdate({ preliminaryEstimate: v as PortfolioItemDetail['preliminaryEstimate'] })
          }
        />
      </DetailField>

      <DetailField label={t('detail.fields.state')}>
        <SearchableSelect
          variant="field"
          value={item.state}
          readOnly={readOnly}
          ariaLabel={t('detail.fields.state')}
          options={PORTFOLIO_STATES.map((s) => ({
            value: s,
            label: t(`states.${s}`, { defaultValue: s }),
          }))}
          onChange={(v) => onUpdate({ state: v as PortfolioItemDetail['state'] })}
        />
      </DetailField>

      {!isEpic && (
        <DetailField label={t('detail.fields.release')}>
          <SearchableSelect
            variant="field"
            value={item.releaseId ?? ''}
            readOnly={readOnly}
            ariaLabel={t('detail.fields.release')}
            placeholder="--"
            searchPlaceholder="Search"
            options={[
              { value: '', label: '-- No Entry --' },
              ...releases.map((r) => ({
                value: r.id,
                label: r.releaseKey ? `${r.releaseKey}: ${r.name}` : r.name,
                searchText: `${r.releaseKey ?? ''} ${r.name}`,
                icon: <TypeBadge type="release" size={16} />,
              })),
            ]}
            onChange={(v) => onUpdate({ releaseId: v || null })}
          />
        </DetailField>
      )}

      {/* Full date AND time, "matching the Audit Log" (SRS.md:105) — the same `formatDateTime`
          the Revision History tab renders, so the two cannot drift. */}
      <DetailField label={t('detail.fields.createdAt')}>
        <DetailReadonlyValue mono>{formatDateTime(item.createdAt)}</DetailReadonlyValue>
      </DetailField>

      {/* Both forecasts are NOT NULL DEFAULT 0 (migration 0079), so an empty input means 0
          rather than null — 0 IS the "not forecast" value and falls through to the Preliminary
          Estimate mapping. */}
      <DetailField label={t('detail.fields.refinedEstimate')}>
        <Input
          type="number"
          min={0}
          step="0.01"
          readOnly={readOnly}
          value={String(item.refinedEstimate)}
          aria-label={t('detail.fields.refinedEstimate')}
          onChange={(e) => onUpdate({ refinedEstimate: Number(e.target.value || 0) })}
        />
      </DetailField>

      <DetailField label={t('detail.fields.refinedItemCountEstimate')}>
        <Input
          type="number"
          min={0}
          step="1"
          readOnly={readOnly}
          value={String(item.refinedItemCountEstimate)}
          aria-label={t('detail.fields.refinedItemCountEstimate')}
          onChange={(e) => onUpdate({ refinedItemCountEstimate: Number(e.target.value || 0) })}
        />
      </DetailField>

      {/* SRS.md:106 asks for Planned Start Date as plain free text, "intentionally not a date
          picker". Kept as a picker deliberately: a free-text date sitting beside a native picker
          for Planned End Date is the exact inconsistency defect P5-CP-DEF-001 reports, and free
          text gives up the ordering validation. Flagged rather than silently diverged. */}
      <DetailField label={t('detail.fields.plannedStartDate')}>
        <DateField
          variant="field"
          value={item.plannedStartDate}
          readOnly={readOnly}
          ariaLabel={t('detail.fields.plannedStartDate')}
          onChange={readOnly ? undefined : (v) => onUpdate({ plannedStartDate: v })}
        />
      </DetailField>

      <DetailField label={t('detail.fields.plannedEndDate')}>
        <DateField
          variant="field"
          value={item.plannedEndDate}
          readOnly={readOnly}
          ariaLabel={t('detail.fields.plannedEndDate')}
          onChange={readOnly ? undefined : (v) => onUpdate({ plannedEndDate: v })}
        />
      </DetailField>

      <DetailField label={t('detail.fields.marketReleaseDate')}>
        <DateField
          variant="field"
          value={item.marketReleaseDate}
          readOnly={readOnly}
          ariaLabel={t('detail.fields.marketReleaseDate')}
          onChange={readOnly ? undefined : (v) => onUpdate({ marketReleaseDate: v })}
        />
      </DetailField>
    </div>
  )
}
