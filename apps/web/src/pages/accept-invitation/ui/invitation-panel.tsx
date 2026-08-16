/**
 * The one centred, single-purpose panel this page ever renders — pending, refused, or joined.
 *
 * The page is reached by a click from an EMAIL, so it paints before any data exists and its whole job
 * is to say which of three things is true. That makes a `Card` + copy + one or two actions the entire
 * surface, and it is a component rather than JSX inside the page because `FRONTEND_CONVENTIONS.md` §1
 * forbids a page-level component defined in a `*-page.tsx`.
 *
 * `tone` decides the ARIA role, and the distinction is load-bearing rather than decorative:
 * `role="status"` for the in-flight state (polite — the reader is waiting, not being told something
 * went wrong) and `role="alert"` for a refusal (assertive — it interrupts, because the reader has to
 * act). This is the same pairing `RequirePermission` is pinned on in
 * `src/test/route-permission.contract.test.tsx`: a pending affordance must never be mistakable for a
 * denial, and a screen-reader user is exactly who would otherwise confuse them.
 */
import type { ReactNode } from 'react'

import { Card, CardBody } from '@/shared/ui/card'
import { cn } from '@/shared/lib/utils'

export function InvitationPanel({
  tone,
  icon,
  title,
  description,
  detail,
  actions,
}: {
  /** `pending` → `role="status"`; `refused` → `role="alert"`. */
  tone: 'pending' | 'refused'
  icon: ReactNode
  title: string
  description: string
  /** Optional second line — the server's own message, or which account is signed in. */
  detail?: ReactNode
  actions?: ReactNode
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-5 py-10">
      <Card className="w-full max-w-md">
        <CardBody
          role={tone === 'pending' ? 'status' : 'alert'}
          className="flex flex-col items-center gap-3 px-7 py-10 text-center"
        >
          {/*
            `aria-hidden` on the icon well, not on the icon: the pending icon is a `Spinner`, which
            carries its own `role="status"` and `aria-label="Loading"`. Nested inside this panel's live
            region that is announced TWICE and the second announcement ("Loading") is the less useful
            one, since the panel's own title and description say what is loading. Hiding the well
            covers the refused case too, where the icon is purely decorative.
          */}
          <div
            aria-hidden="true"
            className={cn(
              'flex h-14 w-14 items-center justify-center rounded-full',
              tone === 'refused' ? 'bg-destructive-bg' : 'bg-primary-lighter',
            )}
          >
            {icon}
          </div>
          {/*
            `data-slot`, as every `shared/ui` primitive carries: it names the three lines so the
            page's own spec can compare the TITLE + DESCRIPTION across states without dragging the
            `detail` line in. That matters — `detail` holds the server's message on the `unknown`
            state, which differs per failure, so a distinctness assertion over the whole panel's text
            would pass even if all seven states shared one headline.
          */}
          <p data-slot="invitation-title" className="text-ui-xl font-semibold text-foreground">
            {title}
          </p>
          <p
            data-slot="invitation-description"
            className="max-w-sm text-ui-lg text-muted-foreground"
          >
            {description}
          </p>
          {detail ? (
            <p data-slot="invitation-detail" className="max-w-sm text-ui-sm text-foreground-subtle">
              {detail}
            </p>
          ) : null}
          {actions ? (
            <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>
          ) : null}
        </CardBody>
      </Card>
    </main>
  )
}
