import { Eye } from 'lucide-react'
import { BRAND } from '@/shared/config/brand'

/**
 * Small "View only" pill shown in a page/toolbar header when the current user
 * lacks edit/create permission for that surface. Single source of truth so the
 * read-only affordance looks identical everywhere (Team Board, Portfolio, …).
 */
export function ViewOnlyBadge({ label = 'View only' }: { label?: string }) {
  return (
    <span
      className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: BRAND.pageBg, color: BRAND.textMuted }}
    >
      <Eye size={11} /> {label}
    </span>
  )
}
