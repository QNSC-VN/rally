/**
 * DetailTabBar — the shared tab bar under {@link DetailHeader}, with an underlined
 * active tab.
 *
 * DARK by default: it sits inside the `bg-primary-dark` header block and continues
 * it, because the tabs name the entity the header names and a white band between the
 * two split one heading into two. Rally draws its tab strip light on the page
 * background instead; we diverge deliberately.
 *
 * `light` restores that Rally arrangement, and {@link DetailLayout} turns it on by
 * itself for a page with a `summary` — the summary has to sit under the header, which
 * pushes the tabs below it, and navy / white / navy would be one band too many.
 * Only the Capacity Plan hits that path today.
 *
 * Every detail page (release, milestone, iteration, work-item, capacity plan)
 * previously hand-rolled this exact `<button>` row, so they drifted. This is the
 * single source of truth; the in-content tab bar remains `shared/ui/tabs.tsx`.
 *
 * Controlled: the caller owns the active key and renders the active panel as the
 * {@link DetailLayout} children — this bar only switches keys.
 */
import type { ReactNode } from 'react'

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
  light = false,
}: {
  tabs: DetailTab[]
  activeTab: string
  onTabChange: (key: string) => void
  /**
   * Render on the page background instead of inside the dark header block.
   *
   * Only for a layout whose summary sits between the header and the tabs — {@link DetailLayout}
   * sets this itself. A caller should not pick the variant; the position decides it.
   */
  light?: boolean
}) {
  return (
    <div
      // Dark by default, continuing the header block above rather than starting the page body: the
      // tabs name the entity the header names, and a white band between the two split one heading
      // into two. `light` is the exception, for a bar that has been pushed below a summary.
      className={cn(
        'flex shrink-0 items-stretch gap-1 px-4',
        light ? 'border-b border-border-inner bg-card' : 'bg-primary-dark',
      )}
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
              // The active rule is an inset ring drawn INSIDE the button so it sits flush with the
              // bar's lower edge and does not stack with the border into a 3px line.
              //
              // Two palettes, because a colour picked against white does not carry on navy:
              // `text-muted-foreground` and `primary-light` disappear on the dark bar, and white
              // disappears on the light one.
              light
                ? active
                  ? 'text-primary-light shadow-[inset_0_-2px_0_0_var(--primary-light)]'
                  : 'text-muted-foreground hover:text-foreground'
                : active
                  ? 'text-white shadow-[inset_0_-2px_0_0_var(--color-white)]'
                  : 'text-white/70 hover:text-white',
            )}
          >
            {tab.icon && <span className="flex h-5 items-center justify-center">{tab.icon}</span>}
            <span className="flex items-center gap-1.5">
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-ui-xs font-semibold',
                    light ? 'bg-surface-subtle text-muted-foreground' : 'bg-white/15 text-white/90',
                  )}
                >
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
