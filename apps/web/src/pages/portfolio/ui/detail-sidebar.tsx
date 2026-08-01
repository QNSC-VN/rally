/**
 * Portfolio item detail sidebar — the same controls the Work Item sidebar uses.
 *
 * Every field here is a SHARED component, matched one-for-one against
 * `pages/work-item/ui/detail-sidebar.tsx`: `FormField` for the label, then
 * `SearchableSelect variant="field"` for an enum or an entity reference,
 * `OwnerSelectField` / `TeamSelectField` for the two identity pickers, `Input` for a
 * number, `DateField variant="field"` for a date, and `DetailReadonlyValue` for anything
 * the API will not accept. Nothing is hand-rolled, because the point of the exercise is
 * that a field looks and behaves identically whichever detail page you opened.
 *
 * Saving is buffered, also matching Work Item: every control calls `onUpdate`, which is
 * `setField` from `usePendingPatch` in the page, and the page shows a `SaveCancelBar`.
 * Nothing here writes on its own — a sidebar that half-saves immediately and half-saves
 * on a button is the worst of both.
 *
 * Feature-only fields (Epic, Team, Release) are OMITTED for an Epic rather than disabled:
 * all three are Feature-only by CHECK constraint, so offering a control that the database
 * refuses would be a lie about what the form can do.
 */
import { useTranslation } from 'react-i18next'

import { type PortfolioItem, type UpdatePortfolioItemBody } from '@/features/portfolio/api'
import { PortfolioItemType } from '@/entities/work-item/model/types'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { DetailField, DetailReadonlyValue } from '@/shared/ui/detail'
import { OwnerSelectField, TeamSelectField } from '@/shared/ui/entity-select-field'
import { DateField } from '@/shared/ui/date-field'
import { Input } from '@/shared/ui/input'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { formatDateIso } from '@/shared/lib/utils'
import { PORTFOLIO_STATES, PRELIMINARY_ESTIMATE_SIZES } from '../model/portfolio-states'

/** A team as `TeamSelectField` wants it. */
interface TeamOption {
  id: string
  name: string
  key?: string | null
}

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
  teams,
  releases,
  epics,
  onUpdate,
}: {
  /** The item MERGED with pending edits — render this, never the raw server value. */
  item: PortfolioItem
  canEdit: boolean
  members: MemberOption[]
  teams: TeamOption[]
  releases: { id: string; releaseKey: string | null; name: string }[]
  /** Candidate parents. Empty for an Epic, which has no parent. */
  epics: { id: string; itemKey: string; name: string }[]
  onUpdate: (patch: UpdatePortfolioItemBody) => void
}) {
  const { t } = useTranslation('portfolio')
  const isEpic = item.type === PortfolioItemType.Epic
  const readOnly = !canEdit

  return (
    <div className="flex flex-col gap-3">
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
          onChange={(v) => onUpdate({ state: v as PortfolioItem['state'] })}
        />
      </DetailField>

      <OwnerSelectField
        label={t('detail.fields.owner')}
        value={item.ownerId}
        members={members}
        disabled={readOnly}
        onChange={(v) => onUpdate({ ownerId: v || null })}
      />

      {/* Project is read-only: the PATCH accepts `projectId`, but moving an item also
          resets its Team and drops a cross-project Release or Epic, so it belongs to the
          grid's Project cell where that consequence is visible in the row. */}
      <DetailField label={t('detail.fields.project')}>
        <DetailReadonlyValue>{item.projectName ?? '--'}</DetailReadonlyValue>
      </DetailField>

      {!isEpic && (
        <>
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

          <TeamSelectField
            label={t('detail.fields.team')}
            value={item.teamId}
            teams={teams}
            disabled={readOnly}
            onChange={(v) => onUpdate({ teamId: v || null })}
          />

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
        </>
      )}

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
            onUpdate({ preliminaryEstimate: v as PortfolioItem['preliminaryEstimate'] })
          }
        />
      </DetailField>

      {/* Creation Date sits ABOVE the two refined forecasts, per the BA spec's revised
          right-rail order: refinement happens after the item exists. */}
      <DetailField label={t('detail.fields.createdAt')}>
        <DetailReadonlyValue mono>{formatDateIso(item.createdAt)}</DetailReadonlyValue>
      </DetailField>

      {/* Both forecasts are NOT NULL DEFAULT 0 (migration 0077), so an empty input means
          0 rather than null — 0 IS the "not forecast" value and falls through to the
          Preliminary Estimate mapping. */}
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

      {/* An Epic's child count, the Epic-side counterpart to a Feature's Epic link. */}
      {isEpic && (
        <DetailField label={t('detail.children.featuresHeading')}>
          <DetailReadonlyValue mono>{item.childFeatureCount}</DetailReadonlyValue>
        </DetailField>
      )}
    </div>
  )
}
