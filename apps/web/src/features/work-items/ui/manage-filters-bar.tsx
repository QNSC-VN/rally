/**
 * Manage Filters banner — the popover trigger plus one control per chosen column.
 *
 * Rendered inside `PageToolbar`'s `filters` slot, which is the collapsible filter
 * banner (`P2-IS-FR-021` "Show/Hide filter banner"). The chooser is the FIRST
 * node, per `P2-BL-FR-020` ("Manage Filters nằm bên trái trong filter banner").
 *
 * Control kinds follow `P2-BL-FR-006` / `P2-IS-FR-023` / `P2-IS-FR-024`: ID, Name
 * and the estimate/hours columns are text or number inputs; everything else is a
 * dropdown. Every one of them maps to a SERVER predicate — see
 * `useManageFilters` and the two list repositories. Nothing here narrows an
 * already-fetched page.
 */
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { InlineSelect } from '@/shared/ui/native-select'
import { ManageFiltersMenu } from './manage-filters-menu'
import type { FilterFieldDef, ManageFiltersState } from '../model/manage-filters'

/** Toolbar-scale input: `Input`'s own padding is form-field size. */
const FIELD_CLASS = 'h-7 w-28 px-2 py-0 text-ui-sm'

function FieldControl<K extends string>({
  field,
  state,
}: {
  field: FilterFieldDef<K>
  state: ManageFiltersState<K>
}) {
  const { t } = useTranslation('common')
  const value = state.draft[field.key] ?? ''

  if (field.kind === 'select') {
    return (
      <InlineSelect
        value={value}
        aria-label={t('manageFilters.valueLabel', { field: field.label })}
        onChange={(e) => state.setDraftValue(field.key, e.target.value)}
        className="w-auto"
      >
        <option value="">{t('manageFilters.any')}</option>
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </InlineSelect>
    )
  }

  return (
    <Input
      type={field.kind === 'number' ? 'number' : 'text'}
      min={field.kind === 'number' ? 0 : undefined}
      step={field.kind === 'number' ? 0.01 : undefined}
      value={value}
      aria-label={t('manageFilters.valueLabel', { field: field.label })}
      className={FIELD_CLASS}
      onChange={(e) => state.setDraftValue(field.key, e.target.value)}
      // Enter commits, so a typed value does not need a mouse trip to Apply.
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          state.apply()
        }
      }}
    />
  )
}

export function ManageFiltersBar<K extends string>({ state }: { state: ManageFiltersState<K> }) {
  const { t } = useTranslation('common')

  return (
    <>
      <ManageFiltersMenu state={state} />

      {state.visible.map((field) => (
        <label
          key={field.key}
          className="flex items-center gap-1.5 text-ui-sm font-semibold text-muted-foreground"
        >
          {field.label}
          <FieldControl field={field} state={state} />
        </label>
      ))}

      {state.visible.length > 0 && (
        <Button size="sm" onClick={state.apply} disabled={!state.dirty}>
          {t('manageFilters.apply')}
        </Button>
      )}

      {state.activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={state.clear}>
          {t('manageFilters.clear')}
        </Button>
      )}
    </>
  )
}
