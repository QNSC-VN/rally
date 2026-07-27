import type { ReactNode } from 'react'

/**
 * SettingsTabHeader — the one page-header band shared by every Settings tab.
 *
 * Renders an identical title + optional one-line description + optional
 * right-aligned actions on a full-width white band with a bottom divider, so
 * list tabs (Users/Teams/Audit) and form tabs (Profile/Workspace/…) all open
 * with the same heading size and position. The settings shell no longer renders
 * its own <h2>; each tab renders this instead.
 */
export function SettingsTabHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle bg-card px-6 py-3.5">
      <div className="min-w-0">
        <h2 className="text-ui-lg font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="mt-0.5 truncate text-ui-sm text-foreground-subtle">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
