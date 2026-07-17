/**
 * IterationPicker — the compact prev / dropdown / next iteration selector used
 * by the tracking surfaces (Team Board, Reports). Single source of truth so the
 * control can't drift between pages.
 *
 * Selection persistence (last-viewed per project) is owned by the caller via
 * `selectedId` / `onSelect`; this component is purely presentational.
 */
import { useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { BRAND } from '@/shared/config/brand'

export interface PickerIteration {
  id: string
  name: string
  startDate: string | null
  endDate: string | null
}

function fmtRange(it: Pick<PickerIteration, 'startDate' | 'endDate'>) {
  return `${it.startDate ?? '—'} - ${it.endDate ?? '—'}`
}

export function IterationPicker({
  iterations,
  selectedId,
  onSelect,
}: {
  iterations: PickerIteration[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedIndex = iterations.findIndex((i) => i.id === selectedId)
  const selected = iterations[selectedIndex]

  function move(dir: -1 | 1) {
    const next = selectedIndex + dir
    if (next >= 0 && next < iterations.length) onSelect(iterations[next].id)
  }

  return (
    <div
      className="flex items-center"
      style={{ border: `1px solid ${BRAND.border}`, borderRadius: 2, height: 28 }}
    >
      <button
        type="button"
        disabled={selectedIndex <= 0}
        onClick={() => move(-1)}
        className="flex h-full items-center px-1.5 disabled:opacity-40"
        style={{ borderRight: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
        aria-label="Previous iteration"
      >
        <ChevronLeft size={14} />
      </button>
      <div className="relative h-full">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-full items-center gap-2.5 px-2.5 text-left"
          style={{ minWidth: 280, color: BRAND.textPrimary }}
        >
          <span className="text-[12px] font-semibold whitespace-nowrap">
            {selected?.name ?? 'No iteration'}
          </span>
          {selected && (
            <span className="text-[11px] whitespace-nowrap" style={{ color: BRAND.textSecondary }}>
              {fmtRange(selected)}
            </span>
          )}
          <ChevronDown size={12} style={{ marginLeft: 'auto', color: BRAND.textMuted }} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              className="absolute top-full left-0 z-50 mt-1 overflow-y-auto py-1"
              style={{
                width: 360,
                maxHeight: 300,
                backgroundColor: BRAND.surface,
                borderRadius: 2,
                border: `1px solid ${BRAND.border}`,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}
            >
              {iterations.length === 0 && (
                <div className="px-3 py-2 text-[11px]" style={{ color: BRAND.textMuted }}>
                  No iterations
                </div>
              )}
              {iterations.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => {
                    onSelect(it.id)
                    setOpen(false)
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-[#f0f2f5]"
                  style={{ backgroundColor: it.id === selectedId ? '#eef3fb' : 'transparent' }}
                >
                  <span className="text-[12px] font-medium" style={{ color: BRAND.textPrimary }}>
                    {it.name}
                  </span>
                  <span className="text-[11px]" style={{ color: BRAND.textMuted }}>
                    {fmtRange(it)}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        disabled={selectedIndex < 0 || selectedIndex >= iterations.length - 1}
        onClick={() => move(1)}
        className="flex h-full items-center px-1.5 disabled:opacity-40"
        style={{ borderLeft: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
        aria-label="Next iteration"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )
}
