import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

/**
 * SettingsTabHeader — the one page-header band shared by every Settings tab.
 *
 * Renders an identical title + optional one-line description + optional
 * right-aligned actions on a full-width white band with a bottom divider, so
 * list tabs (Users/Teams/Audit) and form tabs (Profile/Workspace/…) all open
 * with the same heading size and position.
 *
 * `contained`: form tabs pass this so the title + description align to the same
 * centered max-width column as the cards below (the modern centered-settings
 * layout). The divider still runs edge-to-edge. List tabs leave it off, so the
 * title sits at the left of their full-width table.
 */
export function SettingsTabHeader({
  title,
  description,
  actions,
  contained = false,
}: {
  title: string
  description?: string
  actions?: ReactNode
  contained?: boolean
}) {
  return (
    <div className="shrink-0 border-b border-border-subtle bg-card px-8 py-3.5">
      <div
        className={cn(
          'flex items-start justify-between gap-4',
          contained && 'mx-auto w-full max-w-3xl',
        )}
      >
        <div className="min-w-0">
          <h2 className="text-ui-lg font-semibold text-foreground">{title}</h2>
          {description && (
            <p className="mt-0.5 truncate text-ui-sm text-foreground-subtle">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
