import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BRAND } from '@/shared/config/brand'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { SearchableSelect } from '@/shared/ui/searchable-select'

// ── Cell primitives (Rally-style chips / pills / progress) ──────────────────

/**
 * Milestones cell — the shared {@link SearchableSelect} in `multiple` mode, so
 * the milestone reference reads identically to the Iteration / Release cells
 * (search box + popover) and the ID column (type glyph + `MS-<n>` key). Each
 * toggle commits immediately (one PUT), matching the grid's inline-edit ethos.
 * The assigned payload carries only {id,name}; the display key is resolved from
 * the project milestone `options`.
 */
export function MilestoneSelectCell({
  selected,
  options,
  canEdit,
  saving,
  onCommit,
}: {
  selected: readonly { id: string; name: string }[]
  options: readonly { id: string; name: string; milestoneKey?: string | null }[]
  canEdit: boolean
  saving: boolean
  onCommit: (ids: string[]) => void
}) {
  const { t } = useTranslation('iteration-status')

  const selectOptions = useMemo(
    () =>
      options.map((o) => ({
        value: o.id,
        label: o.milestoneKey ? `${o.milestoneKey}: ${o.name}` : o.name,
        searchText: `${o.milestoneKey ?? ''} ${o.name}`,
        icon: <TypeBadge type="milestone" size={16} />,
      })),
    [options],
  )
  const value = useMemo(() => selected.map((s) => s.id), [selected])

  return (
    <SearchableSelect
      multiple
      value={value}
      options={selectOptions}
      onChange={onCommit}
      readOnly={!canEdit || saving}
      ariaLabel={t('cells.editMilestones')}
      placeholder={t('cells.milestoneNone')}
      searchPlaceholder={t('cells.searchMilestones')}
      variant="cell"
    />
  )
}

/** Rally "Defect Status" summary pill derived from child-defect counts. */
export function DefectStatusPill({ total, open }: { total: number; open: number }) {
  const { t } = useTranslation('iteration-status')
  if (total === 0) {
    return (
      <span className="text-foreground-subtle" style={{ fontSize: 12 }}>
        {t('cells.defectNone')}
      </span>
    )
  }
  const closed = open === 0
  const bg = closed ? BRAND.successBg : BRAND.warningBg
  const fg = closed ? BRAND.success : BRAND.warning
  const bd = closed ? BRAND.successBorder : BRAND.warningBorder
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 8px',
        borderRadius: 9,
        fontSize: 11,
        fontWeight: 600,
        backgroundColor: bg,
        color: fg,
        border: `1px solid ${bd}`,
      }}
    >
      {closed ? t('cells.defectClosed') : t('cells.defectOpen', { value: open })}
    </span>
  )
}

/** Thin task-completion bar computed from Task State: completed / total tasks.
 * State-based (not To-Do hours) so it agrees with the Team Status screen. */
export function TasksProgress({ total, done }: { total: number; done: number }) {
  if (!total || total <= 0) {
    return (
      <span className="text-foreground-subtle" style={{ fontSize: 12 }}>
        &mdash;
      </span>
    )
  }
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)))
  return (
    <div className="flex w-full items-center gap-1.5" title={`${done}/${total} tasks complete`}>
      <div
        className="bg-border-subtle"
        style={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: pct >= 100 ? BRAND.success : BRAND.primary,
          }}
        />
      </div>
      <span
        className="text-muted-foreground"
        style={{ fontSize: 11, minWidth: 30, textAlign: 'right' }}
      >
        {pct}%
      </span>
    </div>
  )
}
