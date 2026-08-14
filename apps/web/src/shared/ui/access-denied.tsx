/**
 * AccessDenied — the one node a surface renders when the caller is not PERMITTED to see it, as
 * opposed to when the request failed or when the server answered with nothing.
 *
 * Three states, three components, deliberately not one with a boolean:
 *   • `EmptyState`     — the server looked and found nothing. An ANSWER.
 *   • `LoadErrorState` — the request failed. The ABSENCE of an answer.
 *   • `AccessDenied`   — the answer exists and is not ours to see. Neither of the above.
 *
 * Collapsing the third into either of the first two is the defect this closes: a route reachable by
 * bookmark rendered its page, the page's scoped query returned nothing the caller may read, and the
 * grid printed its empty state — "this project has no Features" — a fabricated fact about the data
 * where the truth is a fact about the reader. Phase 4 `02_Roles_Permissions/SRS.md:197` requires
 * Access Denied for exactly this case.
 *
 * So the copy must not read as an error (the user is not broken) or as emptiness (the data is not
 * absent) — and it must not explain that distinction TO the reader either, which is why the hint is
 * one plain sentence about what to do next rather than a description of what kind of state this is. `role="alert"` and the `common:accessDenied.*` keys mirror `load-error-state.tsx`: it
 * replaces a region the reader is looking AT, so it has to be announced, and it goes through i18n
 * like every other string (hardcoded copy is counted by `fe-consistency.ratchet`).
 *
 * UX ONLY. `PolicyGuard` on the API is the authorization boundary and already refuses; this node
 * exists so the refusal reads as a refusal.
 */
import { ShieldOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/shared/lib/utils'

export function AccessDenied({
  /**
   * Optional surface-specific headline. Falls back to the shared `common:accessDenied.title`, which
   * is always more honest than an empty state even when un-tailored.
   */
  title,
  /** Vertical rhythm: `md` for page bodies, `sm` for cards, tabs and popovers. */
  size = 'md',
  className,
}: {
  title?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center',
        size === 'sm' ? 'py-10' : 'py-16',
        className,
      )}
    >
      {/* Not `text-destructive`: a permission boundary is not a fault, and colouring it like one is
          what makes a reader file a bug instead of asking for access. */}
      <ShieldOff size={size === 'sm' ? 22 : 28} className="text-foreground-subtle" />
      <p className="text-ui-lg font-medium text-foreground">
        {title ?? t('common:accessDenied.title', "You don't have access to this page.")}
      </p>
      <p className="text-ui-sm text-foreground-subtle">
        {t('common:accessDenied.hint', 'If you need it, ask your Workspace Admin.')}
      </p>
    </div>
  )
}
