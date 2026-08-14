/**
 * LoadErrorState — the one node a surface renders when its request FAILED, as opposed to when the
 * server answered with nothing.
 *
 * It exists so the distinction is cheap to honour. Before this, saying "this failed" meant
 * hand-assembling an `EmptyState` + `AlertTriangle` + a per-namespace `loadError` key, so most
 * surfaces skipped it and fell through to their empty state instead — which reads as a
 * measurement (see `shared/lib/query/resource.ts` for the list of what that shipped).
 *
 * Deliberately NOT an `EmptyState` variant: an empty state is an answer and this is the absence
 * of one, and the two must never be reachable by flipping a boolean on the same component.
 */
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { errorMessage } from '@/shared/lib/toast'
import { cn } from '@/shared/lib/utils'

export function LoadErrorState({
  /** The thrown value from `ListResource.error` / `ValueResource.error`. Shown as the detail line. */
  error,
  /**
   * Optional surface-specific headline (e.g. `t('releases:loadError')`). Falls back to the shared
   * `common:loadFailed`, which is always more honest than an empty state even when un-tailored.
   */
  title,
  /** Vertical rhythm: `md` for page bodies, `sm` for cards, tabs and popovers. */
  size = 'md',
  className,
}: {
  error?: unknown
  title?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const { t } = useTranslation()
  const detail = error === undefined ? undefined : errorMessage(error, '')

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center',
        size === 'sm' ? 'py-10' : 'py-16',
        className,
      )}
    >
      <AlertTriangle size={size === 'sm' ? 22 : 28} className="text-destructive" />
      <p className="text-ui-lg font-medium text-foreground">
        {title ?? t('common:loadFailed', 'Could not load this data.')}
      </p>
      <p className="text-ui-sm text-foreground-subtle">
        {t('common:loadFailedHint', 'This is a load failure, not an empty result. Try again.')}
      </p>
      {detail ? <p className="text-ui-xs text-foreground-disabled">{detail}</p> : null}
    </div>
  )
}
