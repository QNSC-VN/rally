/**
 * DetailTabBar — the shared DARK tab bar that sits directly under
 * {@link DetailHeader} inside a detail page's `bg-primary-dark` header block.
 *
 * Every detail page (release, milestone, iteration, work-item) previously
 * hand-rolled this exact `<button>` row with inline `color` / `borderBottom`
 * active styling, so they drifted. This is the single source of truth for the
 * dark tab bar; the light in-content tab bar remains `shared/ui/tabs.tsx`.
 *
 * Controlled: the caller owns the active key and renders the active panel as
 * the {@link DetailLayout} children — this bar only switches keys.
 */
import type { ReactNode } from 'react'

import { BRAND } from '@/shared/config/brand'

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
    <div className="flex h-16 items-stretch gap-2 px-5" role="tablist">
      {tabs.map((tab) => {
        const active = tab.key === activeTab
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTabChange(tab.key)}
            className="flex flex-col items-center justify-center gap-1 px-4 text-ui-sm font-medium transition-colors"
            style={{
              backgroundColor: active ? BRAND.primaryLight : 'transparent',
              color: active ? 'white' : BRAND.accentBg,
            }}
          >
            {tab.icon && <span className="flex h-5 items-center justify-center">{tab.icon}</span>}
            <span className="flex items-center gap-1.5">
              {tab.label}
              {tab.count !== undefined && (
                <span className="rounded-sm bg-white/15 px-1 text-ui-2xs font-semibold text-white">
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
