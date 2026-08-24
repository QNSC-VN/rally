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
 * `contained`: form tabs pass this to CAP THE WIDTH of the title + description, so a long
 * description does not run the full bleed of a wide screen. It does not move them — the heading
 * starts at the left edge either way, in line with the sidebar, the breadcrumb above it and the
 * cards below. The divider still runs edge-to-edge. List tabs leave it off and simply take the full
 * width of their table.
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
      {/*
       * LEFT-ALIGNED, always. `contained` caps the WIDTH so a long description does not run the
       * full bleed of a wide screen; it used to add `mx-auto` as well, which centred the whole
       * heading in the content column. That put every Settings title adrift in the middle of the
       * page — out of line with the sidebar it belongs to, with the breadcrumb above it, and with
       * the cards below it, all of which start at the left edge. Reported 2026-08-24 across eight
       * tabs, which is every tab that passes `contained`.
       */}
      <div
        className={cn('flex items-start justify-between gap-4', contained && 'w-full max-w-3xl')}
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
