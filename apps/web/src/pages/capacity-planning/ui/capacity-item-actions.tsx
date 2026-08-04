import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowRightLeft, ArrowUp, Scale, Settings, Trash2, Undo2 } from 'lucide-react'

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
  onMoveUp,
  onMoveDown,
  onAllocate,
  onMove,
  onUnassign,
  onRemove,
}: {
  /** `FE-3` — names the row in the trigger's accessible name; an id would be useless. */
  itemKey: string
  /** Whether this Feature holds any team, which is what makes `Remove All Assignments` meaningful. */
  hasTeams: boolean
  /**
   * The BA's `Move up` / `Move down`: reorder by one position instead of dragging.
   *
   * Both are omitted at the ends of the list rather than disabled — a menu item that cannot act is
   * noise, and the row's position already says why it is absent. Rally ranks by dragging and offers
   * no such items; these exist because the BA's catalog asks for them, and because a keyboard user
   * has no drag.
   */
  onMoveUp?: () => void
  onMoveDown?: () => void
  /** Split this Feature across teams — Rally's `Allocate`. */
  onAllocate?: () => void
  /** Rally's `Move To Another Plan`: plan this Feature in a different plan of the same project. */
  onMove?: () => void
  /** Rally's `Remove All Assignments`: keep the Feature on the plan, empty its teams. */
  onUnassign?: () => void
  /** Rally's `Remove From Plan`: take the Feature off the plan entirely. */
  onRemove?: () => void
}) {
  const { t } = useTranslation('capacity')

  const showUnassign = onUnassign !== undefined && hasTeams
  if (
    onAllocate === undefined &&
    onMove === undefined &&
    onMoveUp === undefined &&
    onMoveDown === undefined &&
    !showUnassign &&
    onRemove === undefined
  ) {
    return null
  }

  return (
    // A GEAR, not the app's `⋮`: the BA calls this control the row's "gear icon" on both tabs, and
    // Rally draws a gear here too. The kebab is the app's menu for a PAGE-level object (the plan's own
    // Edit / Delete / Publish); this one belongs to a row inside it, and the different glyph is what
    // keeps the two from reading as the same menu at two sizes.
    <ActionMenu
      ariaLabel={t('items.actionsLabel', { item: itemKey })}
      icon={<Settings size={13} />}
    >
      {onMoveUp !== undefined && (
        <ActionMenuItem icon={<ArrowUp size={13} />} label={t('items.moveUp')} onClick={onMoveUp} />
      )}
      {onMoveDown !== undefined && (
        <ActionMenuItem
          icon={<ArrowDown size={13} />}
          label={t('items.moveDown')}
          onClick={onMoveDown}
        />
      )}
      {onAllocate !== undefined && (
        <ActionMenuItem
          icon={<Scale size={13} />}
          label={t('items.allocate')}
          onClick={onAllocate}
        />
      )}
      {onMove !== undefined && (
        <ActionMenuItem
          icon={<ArrowRightLeft size={13} />}
          label={t('move.action')}
          onClick={onMove}
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
