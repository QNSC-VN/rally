import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { ColumnFieldsMenu } from '@/shared/ui/column-fields-menu'
import { InlineSelect } from '@/shared/ui/native-select'
import { PageToolbar } from '@/shared/ui/page-toolbar'
import type { ItemColKey } from '../model/columns'

/**
 * The Features tab's toolbar: `Add Features`, then Rally's `Show Filters` / `Show Fields` pair.
 *
 * Rally puts both beside the add button — "Select Show Filters to filter the list of portfolio items
 * that display on this tab", "Select Show Fields to add or remove columns from this list" — so this is
 * the shared `PageToolbar`, which already owns that pair. The Teams tab has neither in Rally and keeps a
 * plain action row instead.
 *
 * Extracted from the detail page because the two filter selects are ~50 lines of markup describing the
 * tab's own facets, and the page they were inline in is a 900-line orchestrator that the file-length
 * ratchet had already stopped growing.
 */
export function FeaturesToolbar({
  canManage,
  onAddFeatures,
  activeFilterCount,
  ownerFilter,
  onOwnerFilterChange,
  ownerTeams,
  assignmentFilter,
  onAssignmentFilterChange,
  planTeams,
  fieldsMenuProps,
}: {
  canManage: boolean
  onAddFeatures: () => void
  activeFilterCount: number
  /** The BA's `Team` facet: who OWNS the Feature, outside the plan. */
  ownerFilter: string
  onOwnerFilterChange: (value: string) => void
  ownerTeams: readonly { id: string; name: string }[]
  /** The `Planned Team Assignment` facet: the team the Feature is planned against IN this plan. */
  assignmentFilter: string
  onAssignmentFilterChange: (value: string) => void
  planTeams: readonly { teamId: string; teamName: string | null }[]
  fieldsMenuProps: React.ComponentProps<typeof ColumnFieldsMenu<ItemColKey>>
}) {
  const { t } = useTranslation('capacity')

  return (
    <PageToolbar
      actions={
        canManage ? (
          <Button size="sm" onClick={onAddFeatures}>
            <Plus size={13} /> {t('addFeatures.action')}
          </Button>
        ) : undefined
      }
      activeFilterCount={activeFilterCount}
      filters={
        <div className="flex flex-wrap items-center gap-4">
          {/* Both facets are COLUMNS on this tab. Filtering by anything the reader cannot see would
              narrow the list for reasons the grid does not explain. */}
          <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
            {t('items.teamColumn')}
            <InlineSelect
              value={ownerFilter}
              aria-label={t('items.teamColumn')}
              onChange={(e) => onOwnerFilterChange(e.target.value)}
              className="w-auto"
            >
              <option value="all">{t('filters.allOwnerTeams')}</option>
              {ownerTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </InlineSelect>
          </label>
          <label className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground">
            {t('items.assignmentColumn')}
            <InlineSelect
              value={assignmentFilter}
              aria-label={t('items.assignmentColumn')}
              onChange={(e) => onAssignmentFilterChange(e.target.value)}
              className="w-auto"
            >
              <option value="all">{t('filters.allTeams')}</option>
              {/* Rally flags unassigned demand on this tab, so filtering TO it is the natural next
                  step — it is the subset a planner has to act on. */}
              <option value="unassigned">{t('items.notAssigned')}</option>
              {planTeams.map((pt) => (
                <option key={pt.teamId} value={pt.teamId}>
                  {pt.teamName ?? '--'}
                </option>
              ))}
            </InlineSelect>
          </label>
        </div>
      }
      fields={<ColumnFieldsMenu {...fieldsMenuProps} />}
    />
  )
}
