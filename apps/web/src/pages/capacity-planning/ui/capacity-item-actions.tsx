import { useTranslation } from 'react-i18next'
import { Scale, Trash2, Undo2 } from 'lucide-react'

import { ActionMenu, ActionMenuItem } from '@/shared/ui/action-menu'

/**
 * Rally's per-item gear, in ONE place.
 *
 * Rally puts this menu next to a portfolio item "in Projects By Total, Projects By Release, or Items
 * tabs" — the same verbs wherever the item is seen. Ours only had it on the Features tab, so a
 * planner reading a team's list had to leave the team to allocate or remove anything on it. Both
 * tabs now render this component, which is also why the two cannot drift into offering different
 * verbs for the same row.
 *
 * Each verb is optional and the menu disappears when none apply, so a published plan (where nothing
 * may change) renders no affordance at all rather than a menu that only rejects.
 */
export function CapacityItemActions({
  itemKey,
  hasTeams,
  onAllocate,
  onUnassign,
  onRemove,
}: {
  /** `FE-3` — names the row in the trigger's accessible name; an id would be useless. */
  itemKey: string
  /** Whether this Feature holds any team, which is what makes `Remove All Assignments` meaningful. */
  hasTeams: boolean
  /** Split this Feature across teams — Rally's `Allocate`. */
  onAllocate?: () => void
  /** Rally's `Remove All Assignments`: keep the Feature on the plan, empty its teams. */
  onUnassign?: () => void
  /** Rally's `Remove From Plan`: take the Feature off the plan entirely. */
  onRemove?: () => void
}) {
  const { t } = useTranslation('capacity')

  const showUnassign = onUnassign !== undefined && hasTeams
  if (onAllocate === undefined && !showUnassign && onRemove === undefined) return null

  return (
    <ActionMenu ariaLabel={t('items.actionsLabel', { item: itemKey })}>
      {onAllocate !== undefined && (
        <ActionMenuItem
          icon={<Scale size={13} />}
          label={t('items.allocate')}
          onClick={onAllocate}
        />
      )}
      {/* The two removal verbs answer different questions. `Remove All Assignments` keeps the
          Feature in the plan and empties its teams — what a planner wants when the Feature is still
          in scope but its split was wrong. */}
      {showUnassign && (
        <ActionMenuItem
          icon={<Undo2 size={13} />}
          label={t('items.removeAllAssignments')}
          onClick={onUnassign}
        />
      )}
      {onRemove !== undefined && (
        <ActionMenuItem
          icon={<Trash2 size={13} />}
          label={t('items.removeFromPlan')}
          destructive
          onClick={onRemove}
        />
      )}
    </ActionMenu>
  )
}
