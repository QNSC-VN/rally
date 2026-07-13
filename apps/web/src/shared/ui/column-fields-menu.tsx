import { useCallback, useEffect, useRef, useState } from 'react'
import { GripVertical, Columns } from 'lucide-react'
import type { ColumnDef } from '@/shared/lib/hooks/use-column-layout'

interface ColumnFieldsMenuProps<K extends string> {
  columns: ColumnDef<K>[]
  order: K[]
  hidden: Set<K>
  onToggle: (key: K) => void
  onReorder: (dragKey: K, overKey: K) => void
  buttonStyle?: React.CSSProperties
}

const PANEL_BG = '#ffffff'
const PANEL_BORDER = '#e1e1e1'
// Brand navy primary (matches --primary in globals.css), not Fluent blue.
const ACCENT = '#1d3f73'

/**
 * "Show Fields" trigger button + dropdown panel: checkbox to toggle a
 * column's visibility, drag handle (native HTML5 DnD) to reorder. Shared
 * across Iteration Status / Backlog / Team Status so each page only wires
 * useColumnLayout() and drops this in the toolbar.
 *
 * **Stale-closure fix**: The active drag key is stored in a `useRef`
 * (not `useState`) so `onDrop` always reads the freshest value without
 * depending on a re-render between `dragStart` and `drop`.
 */
export function ColumnFieldsMenu<K extends string>({
  columns,
  order,
  hidden,
  onToggle,
  onReorder,
  buttonStyle,
}: ColumnFieldsMenuProps<K>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // ── Ref-based drag state (avoids stale-closure bug) ──
  const dragKeyRef = useRef<K | null>(null)
  const [activeDragKey, setActiveDragKey] = useState<K | null>(null)
  const [dropOverKey, setDropOverKey] = useState<K | null>(null)

  const cleanup = useCallback(() => {
    dragKeyRef.current = null
    setActiveDragKey(null)
    setDropOverKey(null)
  }, [])

  useEffect(() => {
    if (!open) return
    function onDocDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const byKey = new Map(columns.map((c) => [c.key, c]))
  const orderedColumns = order.map((k) => byKey.get(k)).filter((c): c is ColumnDef<K> => !!c)

  function handleDragStart(key: K, e: React.DragEvent) {
    dragKeyRef.current = key
    setActiveDragKey(key)
    setDropOverKey(null)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }

  function handleDragOver(key: K, e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const from = dragKeyRef.current
    if (from && from !== key) {
      setDropOverKey(key)
    }
  }

  function handleDrop(key: K, e: React.DragEvent) {
    e.preventDefault()
    const from = dragKeyRef.current
    if (from && from !== key) {
      onReorder(from, key)
    }
    cleanup()
  }

  function handleDragEnd() {
    cleanup()
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5"
        style={{
          fontSize: 12,
          color: open ? ACCENT : '#333333',
          background: open ? '#eef6fc' : 'none',
          border: 'none',
          borderRadius: 2,
          padding: '4px 8px',
          cursor: 'pointer',
          ...buttonStyle,
        }}
      >
        <Columns size={14} /> Show Fields
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            width: 220,
            maxHeight: 340,
            overflowY: 'auto',
            background: PANEL_BG,
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 4,
            boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
            zIndex: 50,
            padding: 4,
          }}
        >
          {orderedColumns.map((col) => {
            const isActive = activeDragKey === col.key
            const isDropTarget = dropOverKey === col.key

            return (
              <div
                key={col.key}
                className="relative flex items-center gap-2"
                style={{
                  padding: '5px 6px',
                  borderRadius: 3,
                  fontSize: 12.5,
                  color: '#333333',
                  background: isDropTarget ? '#f0f6fc' : isActive ? '#f3f3f3' : 'transparent',
                  cursor: 'default',
                  opacity: isActive ? 0.4 : 1,
                  transition: 'background-color 0.12s ease, opacity 0.12s ease',
                }}
                onDragOver={(e) => handleDragOver(col.key, e)}
                onDrop={(e) => handleDrop(col.key, e)}
                onDragLeave={() => setDropOverKey(null)}
              >
                {/* ── Drop indicator (horizontal blue line above the target) ── */}
                {isDropTarget && (
                  <div
                    className="absolute top-0 right-1 left-1 z-10 h-[2px] rounded-full"
                    style={{
                      backgroundColor: ACCENT,
                      boxShadow: '0 0 6px rgba(29,63,115,0.45)',
                    }}
                  />
                )}

                {/* ── Drag handle (only the handle is draggable, not the row) ── */}
                <span
                  draggable
                  onDragStart={(e: React.DragEvent<HTMLSpanElement>) =>
                    handleDragStart(col.key, e as unknown as React.DragEvent)
                  }
                  onDragEnd={handleDragEnd}
                  tabIndex={0}
                  aria-label={`Drag to reorder ${col.label} column`}
                  role="button"
                  className="flex shrink-0 cursor-grab items-center active:cursor-grabbing"
                >
                  <GripVertical
                    size={13}
                    style={{
                      color: isActive ? ACCENT : '#a0a0a0',
                      transition: 'color 0.12s ease',
                    }}
                  />
                </span>

                {/* ── Checkbox + label ── */}
                <label
                  className="flex items-center gap-2"
                  style={{ flex: 1, cursor: col.locked ? 'default' : 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={!hidden.has(col.key)}
                    disabled={col.locked}
                    onChange={() => onToggle(col.key)}
                    style={{ accentColor: ACCENT, cursor: col.locked ? 'default' : 'pointer' }}
                  />
                  {col.label}
                </label>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
