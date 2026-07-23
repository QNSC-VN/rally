/**
 * DetailHeader — the shared dark title bar for every detail page (work item,
 * milestone, release, iteration). One component so the chrome — back button,
 * leading badge, key, title, status, right-side actions — can never drift
 * between detail surfaces.
 *
 * The bar renders `bg-primary-dark text-white`; page-specific controls (watch,
 * save, delete menu, …) are passed via `actions`. Tab rows, when a page has
 * them, are rendered by the caller INSIDE the same dark container below this
 * bar (see DetailTabBar) so header + tabs read as one block.
 */
import type { ReactNode } from 'react'
import { ChevronLeft, X } from 'lucide-react'

import { BRAND } from '@/shared/config/brand'

interface DetailHeaderProps {
  onBack: () => void
  backLabel?: string
  /** Leading glyph/badge (e.g. TypeBadge, or a text type chip). */
  badge?: ReactNode
  /** Monospace key (US-1, GA…), shown before the title with a divider. */
  itemKey?: ReactNode
  /** Title — a string, or an inline-edit input node. */
  title: ReactNode
  /** Status badge, shown right-aligned before actions. */
  status?: ReactNode
  /** Right-side action controls. */
  actions?: ReactNode
}

export function DetailHeader({
  onBack,
  backLabel = 'Back',
  badge,
  itemKey,
  title,
  status,
  actions,
}: DetailHeaderProps) {
  return (
    <div
      className="flex h-12 shrink-0 items-center gap-3 px-4"
      style={{ borderBottom: '1px solid rgba(255,255,255,.18)' }}
    >
      <button
        aria-label={backLabel}
        onClick={onBack}
        className="rounded p-1.5 transition-colors hover:bg-white/10"
      >
        <ChevronLeft size={18} />
      </button>
      {badge}
      {itemKey != null && (
        <>
          <span className="font-mono text-ui-lg font-semibold text-white">{itemKey}</span>
          <span className="h-5 w-px bg-white/25" />
        </>
      )}
      <div className="min-w-0 flex-1 truncate text-base font-semibold">{title}</div>
      {status}
      {actions}
      {/* Close detail editor — shared trailing control on every detail page, so
          the header's right cluster ends the same way everywhere (Rally parity). */}
      <span className="mx-0.5 h-5 w-px bg-white/25" />
      <button
        type="button"
        aria-label="Close detail editor"
        title="Close detail editor"
        onClick={onBack}
        className="rounded p-1.5 transition-colors hover:bg-white/10"
      >
        <X size={18} />
      </button>
    </div>
  )
}

/**
 * DetailHeaderButton — an action button tuned for the dark `DetailHeader` bar.
 * Two soft tones keep the bar low-contrast (the default solid `<Button>` reads
 * far too harsh on `bg-primary-dark`):
 *   • `primary` — a translucent-white fill for the main action (Commit/Accept),
 *   • `ghost`   — transparent with a faint border for secondary actions.
 */
export function DetailHeaderButton({
  children,
  onClick,
  disabled,
  tone = 'ghost',
  title,
  ariaLabel,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'primary' | 'ghost'
  title?: string
  ariaLabel?: string
}) {
  const primary = tone === 'primary'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-ui-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        backgroundColor: primary ? 'rgba(255,255,255,0.16)' : 'transparent',
        color: primary ? 'white' : BRAND.accentBg,
        border: '1px solid',
        borderColor: primary ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.22)',
      }}
    >
      {children}
    </button>
  )
}
