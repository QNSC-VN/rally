/**
 * Portfolio item detail — Epic or Feature (BA spec §5).
 *
 * Composed from the same shared pieces as Work Item detail, field for field:
 * `DetailLayout` + `DetailTabBar` for the chrome, `DetailTwoPane` for the body,
 * `RichTextEditor` for the Description, and the shared form controls in the sidebar
 * (see `ui/detail-sidebar.tsx`). Editing is buffered through `usePendingPatch` and
 * committed by a `SaveCancelBar`, with a `SaveIndicator` in the sidebar header — the
 * identical save model, so the two pages behave the same under a slow network.
 *
 * NOTE Work Item detail hand-rolls its two-pane body and its own sidebar shell rather
 * than using `DetailTwoPane`; it is the only detail page that does. This page uses the
 * shared one, like Release, Milestone, Project and Iteration detail. Matching Work Item's
 * bespoke pane would mean copying the deviation, so the parity here is in the COMPONENTS
 * and the interaction model, not in that one wrapper.
 *
 * What this page deliberately does NOT have, and why — every one is a missing BACKEND,
 * not a styling gap: Attachments, Linked Items and Comments are `/v1/work-items/{id}/…`
 * only (`comments.work_item_id` is a column, not an entity-type pair), there are no
 * portfolio watcher, label or activity endpoints, and Tasks / Defects / Connections have
 * no portfolio equivalent by design. The Children tab is the portfolio-specific tab that
 * replaces them.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from '@tanstack/react-router'

import { TypeBadge } from '@/entities/work-item/ui/badges'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { ProgressBar } from '@/shared/ui/progress-bar'
import { PercentDoneBar } from '@/features/portfolio/ui/percent-done-bar'
import { EmptyState } from '@/shared/ui/empty-state'
import { SkeletonList } from '@/shared/ui/skeleton'
import { RichTextEditor } from '@/shared/ui/rich-text-editor'
import { SaveCancelBar } from '@/shared/ui/save-cancel-bar'
import { SaveIndicator } from '@/shared/ui/save-indicator'
import { usePendingPatch } from '@/shared/lib/hooks/use-pending-patch'
import { useSaveState } from '@/shared/lib/hooks/use-save-state'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useProjectPermissions } from '@/features/access/api'
import { useWorkspaceMembers } from '@/features/workspaces/api'
import { useProjectTeams } from '@/features/teams/api'
import { useReleases } from '@/features/releases/api'
import { PortfolioItemType } from '@/entities/work-item/model/types'
import { DetailField, DetailLayout, DetailSectionHeading, DetailTwoPane } from '@/shared/ui/detail'
import {
  usePortfolioChildFeatures,
  usePortfolioChildren,
  usePortfolioItem,
  usePortfolioItems,
  useUpdatePortfolioItem,
  type PortfolioItem,
  type UpdatePortfolioItemBody,
} from '@/features/portfolio/api'
import { PortfolioDetailSidebar } from './ui/detail-sidebar'

export function PortfolioDetailPage() {
  const { t } = useTranslation('portfolio')
  const navigate = useNavigate()
  const { itemId } = useParams({ from: '/auth/portfolio/$itemId' })
  const [tab, setTab] = useState('details')

  const { data: server, isLoading } = usePortfolioItem(itemId)
  const isEpic = server?.type === 'epic'
  // Only one of these fires — an Epic has child Features, a Feature has linked
  // work items. `enabled` is driven by passing undefined for the wrong shape.
  const { data: childFeatures = [] } = usePortfolioChildFeatures(isEpic ? itemId : undefined)
  const { data: children = [] } = usePortfolioChildren(isEpic ? undefined : itemId)

  // Edit rights follow the ITEM's project, not the selected one: this page is reachable
  // from a cross-project grid, so the two are frequently different.
  const { can } = useProjectPermissions(server?.projectId)
  const canEdit = can('portfolio:edit')

  const { workspace } = useAppContext()
  const { data: members = [] } = useWorkspaceMembers(workspace?.workspaceId)
  const { data: projectTeams = [] } = useProjectTeams(server?.projectId)
  const { data: projectReleases = [] } = useReleases(server?.projectId)
  // Candidate parents: this project's Epics. Skipped entirely for an Epic, which has none.
  const epicList = usePortfolioItems({
    type: PortfolioItemType.Epic,
    projectId: server?.projectId,
  })
  const epics = useMemo(
    () =>
      isEpic ? [] : epicList.items.map((e) => ({ id: e.id, itemKey: e.itemKey, name: e.name })),
    [isEpic, epicList.items],
  )
  const releases = useMemo(
    () => projectReleases.map((r) => ({ id: r.id, releaseKey: r.releaseKey, name: r.name })),
    [projectReleases],
  )

  // Buffered editing, exactly as Work Item detail does it: controls mutate a pending
  // patch, the SaveCancelBar commits, the SaveIndicator reports. `value` is the server
  // item merged with the pending edits, so the form always renders what the user typed.
  const update = useUpdatePortfolioItem()
  const { status: saveStatus, errorMsg, wrap: wrapSave } = useSaveState()
  const {
    value: item,
    isDirty,
    saving,
    setField,
    save,
    cancel,
  } = usePendingPatch<PortfolioItem, UpdatePortfolioItemBody>(
    server ?? ({} as PortfolioItem),
    server?.id,
    async (patch) => {
      await wrapSave(async () => {
        await update.mutateAsync({ id: itemId, patch })
      })
    },
  )

  const back = () => void navigate({ to: '/portfolio' })
  const openItem = (id: string) =>
    void navigate({ to: '/portfolio/$itemId', params: { itemId: id } })

  if (isLoading) return <SkeletonList rows={6} />
  if (!server) return <EmptyState title={t('detail.notFound')} />

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
          sidebarTitle={
            <span className="flex items-center gap-2">
              {t('detail.tabs.details')}
              <SaveIndicator status={saveStatus} errorMsg={errorMsg} />
            </span>
          }
          main={
            <div className="flex flex-col gap-4">
              {/* Description first, matching Work Item detail — the same
                  `RichTextEditor`, so the toolbar, the expand affordance and the
                  paste-an-image behaviour are identical. It reports every keystroke
                  into the pending patch; the Save bar decides when it persists. */}
              <RichTextEditor
                title={t('detail.fields.description')}
                value={item.description}
                readOnly={!canEdit}
                onChange={(html) => setField({ description: html })}
              />

              {/* Notes and Release Notes, the same editors in the same order as Work Item
                  detail. `work_items` already carried this exact pair, so migration 0078
                  added the same two columns here rather than inventing a concept. */}
              <RichTextEditor
                title={t('detail.fields.notes')}
                value={item.notes}
                readOnly={!canEdit}
                onChange={(html) => setField({ notes: html })}
              />
              <RichTextEditor
                title={t('detail.fields.releaseNotes')}
                value={item.releaseNotes}
                readOnly={!canEdit}
                onChange={(html) => setField({ releaseNotes: html })}
              />

              {/* Progress is the portfolio-specific block, standing where Work Item puts
                  its Task Roll-up: four read-only indicators derived server-side. */}
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
            </div>
          }
          sidebar={
            <PortfolioDetailSidebar
              item={item}
              canEdit={canEdit}
              members={members}
              teams={projectTeams}
              releases={releases}
              epics={epics}
              onUpdate={setField}
              onOpenItem={openItem}
            />
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

      {/* Same commit control as Work Item detail: it appears only when there is something
          to commit, so a read-only visit never shows it. */}
      <SaveCancelBar
        visible={isDirty}
        saving={saving}
        errorMsg={errorMsg}
        onSave={() => void save()}
        onCancel={cancel}
      />
    </DetailLayout>
  )
}
