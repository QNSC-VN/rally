/**
 * DetailLayout — the single, shared *shell* for every entity detail page
 * (release, milestone, iteration, work-item). The detail-surface equivalent of
 * `shared/ui/table/data-table-frame.tsx`.
 *
 * Why this exists
 * ---------------
 * Release-detail and milestone-detail were byte-for-byte identical chrome — the
 * `flex flex-1 flex-col overflow-hidden bg-background` outer, the
 * `bg-primary-dark text-white` header block, the `<DetailHeader>` and the
 * hand-rolled dark tab bar — and had already drifted (sidebar `w-72` vs `w-80`,
 * `bg-surface` vs `bg-card`). This component owns that chrome so it can never
 * drift again: a detail page supplies header props + tabs, and renders the
 * active tab's panel as `children`.
 *
 * Composition:
 *   <DetailLayout {...headerProps} tabs activeTab onTabChange>
 *     {activeTab === 'details' ? <DetailTwoPane .../> : <SomeTab .../>}
 *   </DetailLayout>
 */
import { useState, type ReactNode } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'

import { DetailHeader } from '@/shared/ui/detail-header'
import { DetailTabBar, type DetailTab } from '@/shared/ui/detail/detail-tab-bar'

interface DetailLayoutProps {
  // ── Header (forwarded to DetailHeader) ───────────────────────────────────
  onBack: () => void
  backLabel?: string
  /** Leading glyph/badge (e.g. a type chip). */
  badge?: ReactNode
  /** Monospace key shown before the title. */
  itemKey?: ReactNode
  /** Title — a string, or an inline-edit input node. */
  title: ReactNode
  /** Status badge, right-aligned before actions. */
  status?: ReactNode
  /** Right-side action controls (save, delete menu…). */
  actions?: ReactNode
  // ── Tabs ─────────────────────────────────────────────────────────────────
  tabs: DetailTab[]
  activeTab: string
  onTabChange: (key: string) => void
  /** The active tab's panel. */
  children: ReactNode
}

export function DetailLayout({
  onBack,
  backLabel,
  badge,
  itemKey,
  title,
  status,
  actions,
  tabs,
  activeTab,
  onTabChange,
  children,
}: DetailLayoutProps) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Header + tabs — shared dark bar */}
      <div className="shrink-0 bg-primary-dark text-white">
        <DetailHeader
          onBack={onBack}
          backLabel={backLabel}
          badge={badge}
          itemKey={itemKey}
          title={title}
          status={status}
          actions={actions}
        />
        <DetailTabBar tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
      </div>

      {children}
    </div>
  )
}

/**
 * DetailTwoPane — the standard "details" tab body: a scrollable main column
 * (rich-text editors / primary content) and a collapsible right sidebar
 * (metadata fields). The sidebar owns the SAME chrome as the Work Item detail
 * sidebar — a sticky `{title}` header with a collapse toggle + divider, and a
 * thin re-open handle when hidden — so every detail page reads identically.
 *
 * Callers pass only the field controls as `sidebar`; the uppercase title header
 * is rendered here (do NOT also pass a `DetailSectionHeading`).
 */
export function DetailTwoPane({
  main,
  sidebar,
  sidebarTitle = 'Details',
}: {
  main: ReactNode
  sidebar: ReactNode
  /** Uppercased header label for the sidebar (e.g. "Details", "Metadata"). */
  sidebarTitle?: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 space-y-6 overflow-y-auto bg-card p-6">{main}</div>

      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          title="Show sidebar"
          className="flex w-6 shrink-0 items-center justify-center border-l border-input bg-surface-subtle transition-colors hover:bg-border-subtle"
        >
          <PanelRightOpen size={14} className="text-muted-foreground" />
        </button>
      ) : (
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-input bg-card">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-avatar bg-card px-3 py-2">
            <span className="text-ui-sm font-semibold tracking-wide text-muted-foreground uppercase">
              {sidebarTitle}
            </span>
            <button
              onClick={() => setCollapsed(true)}
              title="Hide sidebar"
              className="rounded p-1 transition-colors hover:bg-surface-subtle"
            >
              <PanelRightClose size={14} className="text-muted-foreground" />
            </button>
          </div>
          <div className="space-y-5 p-5">{sidebar}</div>
        </aside>
      )}
    </div>
  )
}
