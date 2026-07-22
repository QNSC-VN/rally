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

import { useClickOutside } from '@/shared/lib/hooks/use-click-outside'

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
  const pickerRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false))
  const selectedIndex = iterations.findIndex((i) => i.id === selectedId)
  const selected = iterations[selectedIndex]

  function move(dir: -1 | 1) {
    const next = selectedIndex + dir
    if (next >= 0 && next < iterations.length) onSelect(iterations[next].id)
  }

  return (
    <div
      className="flex items-center border border-border-strong"
      style={{ borderRadius: 2, height: 28 }}
    >
      <button
        type="button"
        disabled={selectedIndex <= 0}
        onClick={() => move(-1)}
        className="flex h-full items-center border-r border-border-strong px-1.5 text-muted-foreground disabled:opacity-40"
        aria-label="Previous iteration"
      >
        <ChevronLeft size={14} />
      </button>
      <div ref={pickerRef} className="relative h-full">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-full items-center gap-2.5 px-2.5 text-left text-foreground"
          style={{ minWidth: 280 }}
        >
          <span className="text-ui-md font-semibold whitespace-nowrap">
            {selected?.name ?? 'No iteration'}
          </span>
          {selected && (
            <span className="text-ui-sm whitespace-nowrap text-muted-foreground">
              {fmtRange(selected)}
            </span>
          )}
          <ChevronDown
            size={12}
            className="text-foreground-subtle"
            style={{ marginLeft: 'auto' }}
          />
        </button>
        {open && (
          <>
            <div
              className="absolute top-full left-0 z-50 mt-1 overflow-y-auto border border-border-strong bg-card py-1"
              style={{
                width: 360,
                maxHeight: 300,
                borderRadius: 2,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}
            >
              {iterations.length === 0 && (
                <div className="px-3 py-2 text-ui-sm text-foreground-subtle">No iterations</div>
              )}
              {iterations.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => {
                    onSelect(it.id)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-background ${it.id === selectedId ? 'bg-primary-lighter' : ''}`}
                >
                  <span className="text-ui-md font-medium text-foreground">{it.name}</span>
                  <span className="text-ui-sm text-foreground-subtle">{fmtRange(it)}</span>
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
        className="flex h-full items-center border-l border-border-strong px-1.5 text-muted-foreground disabled:opacity-40"
        aria-label="Next iteration"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )
}
