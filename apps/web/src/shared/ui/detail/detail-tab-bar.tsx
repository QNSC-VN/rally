/**
 * DetailTabBar — the shared tab bar under {@link DetailHeader}, on the page's own
 * background with an underlined active tab.
 *
 * LIGHT, as Rally draws every tab strip: dark text on white, the active tab marked
 * by a 2px rule beneath it. It used to live inside the dark `bg-primary-dark`
 * header block with the active tab as a filled navy chip, which read as a second
 * toolbar rather than as a place in the page — and it was the last piece of our
 * detail chrome that did not match Rally's.
 *
 * Every detail page (release, milestone, iteration, work-item, capacity plan)
 * previously hand-rolled this exact `<button>` row, so they drifted. This is the
 * single source of truth; the in-content tab bar remains `shared/ui/tabs.tsx`.
 *
 * Controlled: the caller owns the active key and renders the active panel as the
 * {@link DetailLayout} children — this bar only switches keys.
 */
import type { ReactNode } from 'react'

import { BRAND } from '@/shared/config/brand'
import { cn } from '@/shared/lib/utils'

export interface DetailTab {
  /** Stable key; matches the caller's active-tab state. */
  key: string
  /** Visible label (already translated by the caller). */
  label: ReactNode
  /** Optional leading glyph, stacked above the label. */
  icon?: ReactNode
  /** Optional trailing count pill. */
  count?: number
}

export function DetailTabBar({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: DetailTab[]
  activeTab: string
  onTabChange: (key: string) => void
}) {
  return (
    <div
      className="flex shrink-0 items-stretch gap-1 border-b border-border-inner bg-card px-4"
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.key === activeTab
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTabChange(tab.key)}
            className={cn(
              'flex flex-col items-center justify-center gap-1 px-4 py-2 text-ui-md font-medium transition-colors',
              active ? 'text-primary-light' : 'text-muted-foreground hover:text-foreground',
            )}
            // The active rule is drawn INSIDE the button and overlaps the bar's own border, so the
            // two do not stack into a 3px line.
            style={{
              boxShadow: active ? `inset 0 -2px 0 0 ${BRAND.primaryLight}` : undefined,
            }}
          >
            {tab.icon && <span className="flex h-5 items-center justify-center">{tab.icon}</span>}
            <span className="flex items-center gap-1.5">
              {tab.label}
              {tab.count !== undefined && (
                <span className="rounded-full bg-surface-subtle px-1.5 text-ui-2xs font-semibold text-muted-foreground">
                  {tab.count}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
