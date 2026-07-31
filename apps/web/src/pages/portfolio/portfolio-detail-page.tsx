/**
 * Portfolio item detail — Epic or Feature (BA spec §5).
 *
 * Reuses the shared detail shell (`DetailLayout` + `DetailTwoPane` + `DetailField`)
 * so the header bar, tab strip and sidebar chrome match Work Item, Release and
 * Milestone detail exactly.
 *
 * Read-only in this slice: editing lands with the portfolio write paths. The
 * Children tab shows child Features for an Epic and linked Stories/Defects for a
 * Feature, because only the lowest portfolio level attaches to the story hierarchy.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from '@tanstack/react-router'

import { TypeBadge } from '@/entities/work-item/ui/badges'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { OwnerCell } from '@/shared/ui/owner-cell'
import { ProgressBar } from '@/shared/ui/progress-bar'
import { PercentDoneBar } from '@/features/portfolio/ui/percent-done-bar'
import { EmptyState } from '@/shared/ui/empty-state'
import { SkeletonList } from '@/shared/ui/skeleton'
import { DetailField, DetailLayout, DetailSectionHeading, DetailTwoPane } from '@/shared/ui/detail'
import {
  usePortfolioChildFeatures,
  usePortfolioChildren,
  usePortfolioItem,
} from '@/features/portfolio/api'

export function PortfolioDetailPage() {
  const { t } = useTranslation('portfolio')
  const navigate = useNavigate()
  const { itemId } = useParams({ from: '/auth/portfolio/$itemId' })
  const [tab, setTab] = useState('details')

  const { data: item, isLoading } = usePortfolioItem(itemId)
  const isEpic = item?.type === 'epic'
  // Only one of these fires — an Epic has child Features, a Feature has linked
  // work items. `enabled` is driven by passing undefined for the wrong shape.
  const { data: childFeatures = [] } = usePortfolioChildFeatures(isEpic ? itemId : undefined)
  const { data: children = [] } = usePortfolioChildren(isEpic ? undefined : itemId)

  const back = () => void navigate({ to: '/portfolio' })

  if (isLoading) return <SkeletonList rows={6} />
  if (!item) return <EmptyState title={t('detail.notFound')} />

  const { progress, rollup } = item

  return (
    <DetailLayout
      onBack={back}
      backLabel={t('title')}
      badge={<TypeBadge type={item.type} />}
      itemKey={item.itemKey}
      title={item.name}
      tabs={[
        { key: 'details', label: t('detail.tabs.details') },
        {
          key: 'children',
          label: t('detail.tabs.children'),
          count: isEpic ? childFeatures.length : children.length,
        },
      ]}
      activeTab={tab}
      onTabChange={setTab}
    >
      {tab === 'details' ? (
        <DetailTwoPane
          main={
            <div className="flex flex-col gap-4 p-4">
              <DetailSectionHeading>{t('detail.progress.heading')}</DetailSectionHeading>
              <DetailField label={t('detail.progress.percentDonePoints')}>
                <PercentDoneBar
                  metric="points"
                  health={item.health}
                  progress={progress}
                  rollup={rollup}
                />
              </DetailField>
              <DetailField label={t('detail.progress.percentDoneCount')}>
                <PercentDoneBar
                  metric="count"
                  health={item.health}
                  progress={progress}
                  rollup={rollup}
                />
              </DetailField>
              <DetailField label={t('detail.progress.estimatedPoints')}>
                <ProgressBar ratio={progress.estimatedProgressByPoints} />
              </DetailField>
              <DetailField label={t('detail.progress.estimatedCount')}>
                <ProgressBar ratio={progress.estimatedProgressByCount} />
              </DetailField>

              {item.description && (
                <>
                  <DetailSectionHeading>{t('detail.fields.description')}</DetailSectionHeading>
                  <p className="text-ui-sm whitespace-pre-wrap text-foreground">
                    {item.description}
                  </p>
                </>
              )}
            </div>
          }
          sidebar={
            <div className="flex flex-col gap-3">
              <DetailField label={t('detail.fields.state')}>
                {t(`states.${item.state}`, { defaultValue: item.state })}
              </DetailField>
              <DetailField label={t('detail.fields.owner')}>
                <OwnerCell name={item.ownerName} />
              </DetailField>
              <DetailField label={t('detail.fields.project')}>
                {item.projectName ?? '--'}
              </DetailField>
              {/* Team, Release and the parent Epic are Feature-only — an Epic has
                  them all null by CHECK constraint, so showing empty rows would
                  imply they are simply unset. */}
              {!isEpic && (
                <>
                  <DetailField label={t('detail.fields.parent')}>
                    {item.parentKey ?? '--'}
                  </DetailField>
                  <DetailField label={t('detail.fields.team')}>{item.teamName ?? '--'}</DetailField>
                  <DetailField label={t('detail.fields.release')}>
                    {item.releaseName ?? '--'}
                  </DetailField>
                </>
              )}
              <DetailField label={t('detail.fields.preliminaryEstimate')}>
                {t(`sizes.${item.preliminaryEstimate}`, { defaultValue: item.preliminaryEstimate })}
              </DetailField>
              {/* 0, not an em-dash, when there is no forecast: the field is NOT NULL
                  DEFAULT 0 (migration 0077), matching how real Rally shows it. 0 still
                  means "not forecast" to the tier chain, so the Estimated Progress bars
                  fall back to the Preliminary Estimate mapping exactly as before. */}
              <DetailField label={t('detail.fields.refinedEstimate')}>
                {item.refinedEstimate}
              </DetailField>
              <DetailField label={t('detail.fields.refinedItemCountEstimate')}>
                {item.refinedItemCountEstimate}
              </DetailField>
              <DetailField label={t('detail.fields.plannedStartDate')}>
                {item.plannedStartDate ?? '--'}
              </DetailField>
              <DetailField label={t('detail.fields.plannedEndDate')}>
                {item.plannedEndDate ?? '--'}
              </DetailField>
              <DetailField label={t('detail.fields.marketReleaseDate')}>
                {item.marketReleaseDate ?? '--'}
              </DetailField>
            </div>
          }
        />
      ) : (
        <div className="flex flex-col gap-2 overflow-auto p-4">
          <DetailSectionHeading>
            {isEpic ? t('detail.children.featuresHeading') : t('detail.children.itemsHeading')}
          </DetailSectionHeading>
          {isEpic && (
            <p className="text-ui-xs text-foreground-subtle">{t('detail.children.epicNote')}</p>
          )}

          {isEpic
            ? childFeatures.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-3 border-b border-border-inner py-1.5"
                >
                  <IdCell
                    type={f.type}
                    itemKey={f.itemKey}
                    onOpen={() =>
                      void navigate({ to: '/portfolio/$itemId', params: { itemId: f.id } })
                    }
                  />
                  <span className="min-w-0 flex-1 text-ui-sm break-words whitespace-normal text-foreground">
                    {f.name}
                  </span>
                  <span className="text-ui-xs text-muted-foreground">
                    {t(`states.${f.state}`, { defaultValue: f.state })}
                  </span>
                </div>
              ))
            : children.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 border-b border-border-inner py-1.5"
                >
                  <IdCell
                    type={c.type}
                    itemKey={c.itemKey}
                    onOpen={() =>
                      void navigate({ to: '/item/$itemKey', params: { itemKey: c.itemKey } })
                    }
                  />
                  <span className="min-w-0 flex-1 text-ui-sm break-words whitespace-normal text-foreground">
                    {c.title}
                  </span>
                  <span className="text-ui-xs text-muted-foreground">{c.scheduleState}</span>
                </div>
              ))}

          {(isEpic ? childFeatures.length : children.length) === 0 && (
            <p className="text-ui-sm text-foreground-subtle">{t('detail.children.empty')}</p>
          )}
        </div>
      )}
    </DetailLayout>
  )
}
