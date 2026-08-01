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
 * What this page deliberately does NOT have: Linked Items (`work_item_relations` is still
 * keyed by a plain `work_item_id`), portfolio watchers and labels, and Tasks / Defects /
 * Connections, which have no portfolio equivalent by design — the Children tab is the
 * portfolio-specific tab standing in their place.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from '@tanstack/react-router'
import { FileText, History, ListTree } from 'lucide-react'

import { TypeBadge } from '@/entities/work-item/ui/badges'
import { IdCell } from '@/entities/work-item/ui/id-cell'
import { AcceptedChildrenBlock } from '@/features/portfolio/ui/accepted-children-block'
import { EmptyState } from '@/shared/ui/empty-state'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ActivityHistoryTab } from '@/entities/activity/ui/activity-history-tab'
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
import { DetailLayout, DetailSectionHeading, DetailTwoPane } from '@/shared/ui/detail'
import {
  usePortfolioChildFeatures,
  usePortfolioChildren,
  usePortfolioItem,
  usePortfolioItemActivityLog,
  usePortfolioItems,
  useUpdatePortfolioItem,
  type PortfolioItemDetail,
  type UpdatePortfolioItemBody,
} from '@/features/portfolio/api'
import { AttachmentBlock } from '@/features/collaboration/ui/attachment-block'
import { useUploadPastedImages } from '@/features/collaboration/use-upload-pasted-images'
import { CommentThread } from '@/features/collaboration/ui/comment-thread'
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
  const { data: activityLogs = [], isLoading: activityLoading } =
    usePortfolioItemActivityLog(itemId)

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
  // Pasting an image into any of the three editors below inserts a local blob: preview; the
  // real upload happens on Save, through the same pipeline Work Item detail uses.
  const { uploadAndRewrite } = useUploadPastedImages(
    server?.id ? { entityType: 'portfolio_item', entityId: server.id } : undefined,
  )
  const {
    value: item,
    isDirty,
    saving,
    setField,
    save,
    cancel,
  } = usePendingPatch<PortfolioItemDetail, UpdatePortfolioItemBody>(
    server ?? ({} as PortfolioItemDetail),
    server?.id,
    async (patch) => {
      // Upload any pasted-image previews still sitting as blob: URLs before persisting —
      // the same "upload happens on Save" step as Work Item detail, field for field.
      const resolved = { ...patch }
      if (typeof resolved.description === 'string') {
        resolved.description = await uploadAndRewrite(resolved.description)
      }
      if (typeof resolved.notes === 'string') {
        resolved.notes = await uploadAndRewrite(resolved.notes)
      }
      if (typeof resolved.releaseNotes === 'string') {
        resolved.releaseNotes = await uploadAndRewrite(resolved.releaseNotes)
      }
      await wrapSave(async () => {
        await update.mutateAsync({ id: itemId, patch: resolved })
      })
    },
  )

  const back = () => void navigate({ to: '/portfolio' })

  if (isLoading) return <SkeletonList rows={6} />
  if (!server) return <EmptyState title={t('detail.notFound')} />

  return (
    <DetailLayout
      onBack={back}
      backLabel={t('title')}
      badge={<TypeBadge type={item.type} />}
      itemKey={item.itemKey}
      title={item.name}
      /* Icons and the inline count, laid out exactly as Work Item detail builds its tabs:
         the same `size={19}` lucide glyph, and a counted tab renders its number INSIDE the
         icon slot rather than through `TabItem.count`, which is what makes the two tab bars
         read identically. `ListTree` is the Children counterpart of Tasks' `ListChecks`. */
      tabs={[
        { key: 'details', label: t('detail.tabs.details'), icon: <FileText size={19} /> },
        {
          key: 'children',
          label: t('detail.tabs.children'),
          icon: (
            <span className="flex items-center gap-1.5">
              <ListTree size={19} />
              <span className="text-ui-xs font-semibold tabular-nums">
                {isEpic ? childFeatures.length : children.length}
              </span>
            </span>
          ),
        },
        { key: 'history', label: t('detail.tabs.history'), icon: <History size={19} /> },
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

              {/* Total Accepted Children — what real Rally shows here, standing where Work
                  Item detail puts its Task Roll-up. It replaced four separate progress
                  meters: same arithmetic, but framed as the one question a reader of this
                  page is asking, with the unit toggle Rally gives it. */}
              <AcceptedChildrenBlock data={item.acceptedChildren} />

              {/* Attachments — the same table Work Item detail renders (Name / Description /
                  When / Size), from the same component. Migration 0081 made the link table
                  polymorphic, so this is one route tree per entity over one code path, not a
                  second uploader. */}
              <AttachmentBlock
                subject={{ entityType: 'portfolio_item', entityId: item.id }}
                readOnly={!canEdit}
              />

              {/* Comments — the SAME component Work Item detail renders, in the same place
                  (last in the main pane). It takes an entity pair rather than a work-item
                  id because migration 0080 made `comments` polymorphic; the thread itself,
                  including @mentions and own-comment editing, is not duplicated. */}
              <CommentThread
                subject={{ entityType: 'portfolio_item', entityId: item.id }}
                projectId={item.projectId}
                readOnly={!canEdit}
              />
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
            />
          }
        />
      ) : tab === 'history' ? (
        /* The SAME shared tab Release, Milestone and Project detail render — one
           polymorphic activity store means one component, not one per entity. */
        <div className="flex-1 overflow-y-auto bg-card p-6">
          <ActivityHistoryTab
            logs={activityLogs}
            isLoading={activityLoading}
            title={t('detail.history.title')}
            subtitle={t('detail.history.subtitle')}
          />
        </div>
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
