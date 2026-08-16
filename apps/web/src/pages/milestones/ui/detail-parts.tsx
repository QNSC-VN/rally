import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'

import {
  useMilestoneArtifacts,
  useMilestoneArtifactIds,
  useMilestoneArtifactCandidates,
  useSetMilestoneArtifacts,
} from '@/features/milestones/api'
import { ArtifactsTabView } from '@/entities/work-item/ui/artifacts-tab'
import type { ArtifactTableItem } from '@/entities/work-item/ui/artifact-table'
import { listResource } from '@/shared/lib/query/resource'
import { useArtifactPagination } from '@/entities/work-item/ui/use-artifact-pagination'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { PORTFOLIO_TYPE_CONFIG } from '@/entities/work-item/model/types'
import { EMPTY_VALUE } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { SelectionModal } from '@/shared/ui/selection-modal'

// ── Artifacts tab ──────────────────────────────────────────────────────────────

/**
 * A milestone's artifacts come from a POLYMORPHIC link table, so a row is either a work item or a
 * portfolio item and its detail surface differs. The discriminator is the row's own `type`:
 * `work_item_type` and `portfolio_item_type` are disjoint enums, which is why `TypeBadge` already
 * resolves a glyph for all five from one prop and why no extra DTO field is served for it.
 *
 * Duplicated from the release Artifacts tab on purpose — a `pages/` module must not import from
 * another `pages/` module, and two lines here is cheaper than promoting this into `entities/`.
 */
function isPortfolioArtifact(type: string): boolean {
  return type in PORTFOLIO_TYPE_CONFIG
}

/**
 * A portfolio row's Priority is ABSENT: `portfolio_items` has no priority column, so the feed sends
 * `''` and the `EMPTY_VALUE` placeholder is applied here, where presentation rules live. Schedule
 * State gets no equivalent — the shared table renders it as a stepper, which has no text slot.
 */
function withAbsentPlaceholders(rows: ArtifactTableItem[]): ArtifactTableItem[] {
  return rows.map((r) => (r.priority === '' ? { ...r, priority: EMPTY_VALUE } : r))
}

/**
 * Milestone Artifacts — the dashboard rows PLUS the `Add Artifact` control. It was a read-only
 * viewer, which left milestone membership reachable only by opening each item in turn
 * (`GAP-P3-MS-001`), and the one gap with a documented Rally analogue: Rally's milestone detail has
 * its own Artifacts collection page with `Add New` and a multi-select `Remove`.
 *
 * The picker writes the milestone end of the link (`PUT /milestones/:id/artifacts`, SRS §5.2), which
 * shares `assertArtifactsInMilestoneScope` with the work-item end AND with the Feature/Epic detail
 * rail — so an artifact that is legal from any one of the three is legal from all of them.
 *
 * ALL FOUR TYPES. §116 and FR-014 make Story, Defect, Feature and Epic directly assignable (Task
 * excluded), and the picker now offers all four: `useMilestoneArtifactCandidates` reads the portfolio
 * feed alongside the work-item one. That was not cosmetic. The payload REPLACES the direct set, and
 * `SelectionModal` can only toggle rows it renders — so while Features and Epics were absent from the
 * candidate list, a Feature assigned from the Portfolio side was permanently unremovable here, and the
 * *server* would have refused the id anyway under the old `workItemIds` key.
 *
 * Removal is unticking, which is why no row-level `Remove` is reproduced: §4/AC-13 make removal affect
 * nothing but that one relationship (Release, Iteration, rank and item identity are untouched — true
 * by construction, because this write only ever touches `milestone_artifacts`). A row-level control
 * would need a selection column on the shared read-only `ArtifactTable`, i.e. on every surface at once.
 *
 * INHERITED rows are NOT candidates and are not in the baseline. An Epic's child Features and their
 * leaf Stories appear as rows (FR-029) but are derived on read; putting them in the picker's set would
 * post them back as DIRECT assignments nobody made, which is the whole reason the inherited population
 * is never materialised into link rows.
 */
export function ArtifactsTab({
  milestoneId,
  projectIds,
  teamIds,
  canManage,
}: {
  milestoneId: string
  /** The milestone's project scope — its own project plus any linked ones (FR-021/023). */
  projectIds: readonly string[]
  /** Its selected Teams; empty means no team scope, so every team is eligible. */
  teamIds: readonly string[]
  canManage: boolean
}) {
  const { t } = useTranslation('milestones')
  const navigate = useNavigate()
  const pagination = useArtifactPagination()
  const [pickerOpen, setPickerOpen] = useState(false)

  const artifactsQuery = useMilestoneArtifacts(milestoneId, {
    pageSize: pagination.pageSize,
    search: pagination.search || undefined,
  })
  // See the release tab: the failure travels with the rows, so an unreachable endpoint reads as a
  // failure rather than as "no artifacts linked to this milestone".
  const rows = useMemo(
    () => (artifactsQuery.data ? withAbsentPlaceholders(artifactsQuery.data.data) : undefined),
    [artifactsQuery.data],
  )
  const artifacts = listResource({ ...artifactsQuery, data: rows })

  // The full link set, not the visible page: the write REPLACES the list, so a set built from one
  // page would unlink everything past the page boundary.
  const { data: linkedIds = [], isPending: baselinePending } = useMilestoneArtifactIds(
    canManage ? milestoneId : undefined,
  )
  const { items: candidates } = useMilestoneArtifactCandidates(canManage ? projectIds : [], teamIds)
  const setArtifacts = useSetMilestoneArtifacts()

  // The picker cannot open before its BASELINE has arrived. `SelectionModal` materialises its draft
  // from `selectedIds` on the closed→open transition, and a draft shadows the baseline — so opening
  // while the link list is still in flight would freeze `[]` in, and saving would unlink every
  // existing artifact. Same shape as the user-access modal's frozen `teamIds`, with data loss at the
  // end of it instead of a stuck button.
  const pickerReady = canManage && !baselinePending

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {canManage && (
        <div className="flex shrink-0 items-center justify-end border-b border-border-subtle bg-card px-4 py-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!pickerReady}
            onClick={() => setPickerOpen(true)}
          >
            <Plus size={13} />
            {t('artifacts.addButton')}
          </Button>
        </div>
      )}

      <ArtifactsTabView
        artifacts={artifacts}
        pageInfo={artifactsQuery.data?.pageInfo}
        entityNoun="milestone"
        pagination={pagination}
        onOpenItem={(item) =>
          isPortfolioArtifact(item.type)
            ? // A Feature/Epic's detail lives on the Portfolio surface and is addressed by ID:
              // `/item/$itemKey` resolves against `work_items` only and would 404 for FE-6.
              navigate({ to: '/portfolio/$itemId', params: { itemId: item.id } })
            : navigate({ to: '/item/$itemKey', params: { itemKey: item.itemKey } })
        }
      />

      <SelectionModal
        open={pickerOpen && pickerReady}
        onClose={() => setPickerOpen(false)}
        title={t('artifacts.pickerTitle')}
        searchPlaceholder={t('artifacts.pickerSearch')}
        confirmLabel={t('artifacts.pickerConfirm')}
        items={candidates.map((c) => ({
          id: c.id,
          name: `${c.itemKey} · ${c.title}`,
          icon: <TypeBadge type={c.type} size={16} />,
        }))}
        selectedIds={linkedIds}
        onSave={async (artifactIds) => {
          await setArtifacts.mutateAsync({ milestoneId, artifactIds })
        }}
      />
    </div>
  )
}
