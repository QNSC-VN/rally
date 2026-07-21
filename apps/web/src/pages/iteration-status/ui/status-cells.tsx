import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'

// ── Cell primitives (Rally-style chips / pills / progress) ──────────────────

/**
 * Milestones cell — read-only chip summary, or (when editable) a click-to-open
 * checkbox popover to add/remove the work item's milestones. Each toggle
 * commits immediately (one PUT), matching the grid's inline-edit ethos.
 */
export function MilestoneSelectCell({
  selected,
  options,
  canEdit,
  saving,
  onCommit,
}: {
  selected: readonly { id: string; name: string }[]
  options: readonly { id: string; name: string }[]
  canEdit: boolean
  saving: boolean
  onCommit: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{
    left: number
    width: number
    top: number | null
    bottom: number | null
  } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected])

  // The popover must escape the grid's overflow-hidden cells, so it renders in
  // a portal with fixed positioning anchored to the trigger's viewport rect.
  const computePos = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const flipUp = spaceBelow < 200 && r.top > spaceBelow
    setPos({
      left: r.left,
      width: r.width,
      top: flipUp ? null : r.bottom + 4,
      bottom: flipUp ? window.innerHeight - r.top + 4 : null,
    })
  }, [])

  useEffect(() => {
    if (!open) return
    computePos()
    function reposition() {
      computePos()
    }
    function onDocDown(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (popRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    document.addEventListener('mousedown', onDocDown)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      document.removeEventListener('mousedown', onDocDown)
    }
  }, [open, computePos])

  function toggle(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onCommit([...next])
  }

  // Span-based chip (not the <Chip> button) so it can live inside the trigger
  // <button> without nesting interactive elements (invalid HTML / hydration).
  const summary =
    selected.length > 0 ? (
      <>
        <span
          className="min-w-0 flex-1 truncate"
          title={selected.map((m) => m.name).join(', ')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            maxWidth: '100%',
            height: 18,
            padding: '0 6px',
            borderRadius: 3,
            fontSize: 11,
            fontWeight: 600,
            lineHeight: '18px',
            border: `1px solid ${BRAND.borderSubtle}`,
            backgroundColor: BRAND.surfaceHover,
            color: BRAND.textSecondary,
          }}
        >
          <span className="truncate">{selected[0].name}</span>
        </span>
        {selected.length > 1 && (
          <span
            className="shrink-0"
            style={{ fontSize: 11, color: BRAND.textMuted, whiteSpace: 'nowrap' }}
            title={selected.map((m) => m.name).join(', ')}
          >
            +{selected.length - 1}
          </span>
        )}
      </>
    ) : (
      <span style={{ color: BRAND.textMuted, fontSize: 12 }}>&mdash;</span>
    )

  if (!canEdit) {
    return <div className="flex items-center gap-1 overflow-hidden">{summary}</div>
  }

  return (
    <div style={{ width: '100%' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        disabled={saving}
        title="Edit milestones"
        className="flex w-full items-center gap-1 overflow-hidden rounded"
        style={{
          background: open ? BRAND.primaryLighter : 'none',
          border: 'none',
          padding: '2px 4px',
          cursor: saving ? 'default' : 'pointer',
          opacity: saving ? 0.6 : 1,
          textAlign: 'left',
        }}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1">{summary}</span>
        <ChevronDown size={12} style={{ color: BRAND.textMuted, flexShrink: 0 }} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: pos.top ?? undefined,
              bottom: pos.bottom ?? undefined,
              left: pos.left,
              zIndex: 50,
              minWidth: Math.max(200, pos.width),
              maxWidth: 280,
              maxHeight: 260,
              overflowY: 'auto',
              backgroundColor: BRAND.surface,
              border: `1px solid ${BRAND.borderSubtle}`,
              borderRadius: 4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              padding: 4,
            }}
          >
            {options.length === 0 ? (
              <div style={{ padding: '8px 10px', fontSize: 12, color: BRAND.textMuted }}>
                No milestones in this project
              </div>
            ) : (
              options.map((opt) => {
                const checked = selectedIds.has(opt.id)
                return (
                  <label
                    key={opt.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 8px',
                      borderRadius: 3,
                      fontSize: 12,
                      color: BRAND.textPrimary,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = BRAND.surfaceHover)
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(opt.id)}
                      style={{ accentColor: BRAND.primary, cursor: 'pointer' }}
                    />
                    <span className="truncate">{opt.name}</span>
                  </label>
                )
              })
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

/** Rally "Defect Status" summary pill derived from child-defect counts. */
export function DefectStatusPill({ total, open }: { total: number; open: number }) {
  if (total === 0) {
    return <span style={{ fontSize: 12, color: BRAND.textMuted }}>None</span>
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
      {closed ? 'Closed' : `${open} Open`}
    </span>
  )
}

/** Thin task-completion bar computed from Task State: completed / total tasks.
 * State-based (not To-Do hours) so it agrees with the Team Status screen. */
export function TasksProgress({ total, done }: { total: number; done: number }) {
  if (!total || total <= 0) {
    return <span style={{ fontSize: 12, color: BRAND.textMuted }}>&mdash;</span>
  }
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)))
  return (
    <div className="flex w-full items-center gap-1.5" title={`${done}/${total} tasks complete`}>
      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          backgroundColor: BRAND.borderSubtle,
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
      <span style={{ fontSize: 11, color: BRAND.textSecondary, minWidth: 30, textAlign: 'right' }}>
        {pct}%
      </span>
    </div>
  )
}
