/**
 * Manage Filters popover — the checkbox column chooser.
 *
 * `P2-BL-FR-020`: "Manage Filters nằm bên trái trong filter banner; user chọn
 * nhiều column bằng checkbox và Apply để combine filter." So the trigger is the
 * FIRST node in the filter banner, the panel is checkboxes, and Apply lives in
 * the panel (it is also repeated beside the value controls, because a user who
 * has already chosen their columns should not have to re-open a popover to
 * commit a new value — both call the same `apply`).
 *
 * A Radix popover through the shared `AppPopoverContent`, for the reason
 * `ColumnFieldsMenu` records: a hand-positioned `absolute` panel is only correct
 * while its trigger sits at one end of the toolbar, and this one sits at the
 * other end (left).
 */
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { AppPopoverContent } from '@/shared/ui/app-popover'
import { registerOpenPopover, unregisterOpenPopover } from '@/shared/ui/popover-coordinator'
import { Button } from '@/shared/ui/button'
import { SelectionCheckbox } from '@/shared/ui/selection-checkbox'
import type { ManageFiltersState } from '../model/manage-filters'

export function ManageFiltersMenu<K extends string>({ state }: { state: ManageFiltersState<K> }) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  const chosen = state.fields.filter((f) => state.isVisible(f.key)).length

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) registerOpenPopover(close)
        else unregisterOpenPopover(close)
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <Button variant="outline" size="sm" aria-expanded={open}>
          <SlidersHorizontal size={12} />
          {t('manageFilters.trigger')}
          {chosen > 0 && <span className="tabular-nums">({chosen})</span>}
        </Button>
      </PopoverPrimitive.Trigger>

      <AppPopoverContent
        // `start`-aligned: this control is the LEFT edge of the filter banner, so
        // the panel hangs off the trigger's left edge. Radix shifts it back
        // inside the viewport when there is no room.
        align="start"
        sideOffset={4}
        collisionPadding={8}
        className="flex w-64 flex-col gap-1 rounded border border-border-subtle bg-card p-2 shadow-lg"
      >
        <p className="px-1 pb-1 text-ui-2xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t('manageFilters.heading')}
        </p>

        <div className="flex max-h-64 min-h-0 flex-col overflow-y-auto">
          {state.fields.map((field) => (
            <label
              key={field.key}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-ui-md text-foreground hover:bg-surface-hover"
            >
              <SelectionCheckbox
                checked={state.isVisible(field.key)}
                onChange={() => state.toggleVisible(field.key)}
                ariaLabel={t('manageFilters.toggleField', { field: field.label })}
              />
              {field.label}
            </label>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={state.clear}
            disabled={state.activeCount === 0}
          >
            {t('manageFilters.clear')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              state.apply()
              setOpen(false)
            }}
          >
            {t('manageFilters.apply')}
          </Button>
        </div>
      </AppPopoverContent>
    </PopoverPrimitive.Root>
  )
}
