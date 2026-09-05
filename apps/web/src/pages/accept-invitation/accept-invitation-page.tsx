/**
 * `/accept-invitation?token=…` — the page the invitation email links to.
 *
 * THE DEFECT THIS CLOSES. `WorkspaceService.inviteMember` has always emailed
 * `${APP_BASE_URL}/accept-invitation?token=<raw token>`, and that route did not exist: the link fell
 * through to the router's catch-all and rendered Not Found. Nothing in the SPA called
 * `POST /v1/invitations/accept` either, so `WorkspaceService.acceptInvitation` was dead in production —
 * and it is the ONLY place the invited workspace role and the invited per-project access are applied.
 * Invitations sat `pending` until the expiry cron closed them. It went unnoticed because JIT
 * provisioning enrolls a same-domain user on first SSO login anyway, at the connection's default role,
 * so the invitee did get *in* — just not with anything the admin chose.
 *
 * WHY IT SITS UNDER `authRoute`, AND WHY THAT IS THE WHOLE REDIRECT DESIGN. Acceptance requires a
 * signed-in principal (the API route is `@Auth()`, and the email binding compares against the caller's
 * own address), so an unauthenticated arrival must sign in FIRST and come back. `requireAuth`
 * (`app/router/router.tsx`) already does exactly that: it redirects to `/login` with
 * `returnTo = window.location.pathname + window.location.search`, so `?token=` survives;
 * `isSafeReturnTo` in `@quynhonsemiconductor/identity` accepts a root-relative path with a query; the BFF callback
 * 302s back here. Registering this route as a child of `authRoute` is therefore the entire
 * implementation of "sign in, then accept" — nothing else was built for it.
 *
 * NO PERMISSION CODE, deliberately. It is not a nav destination and it is not in `NON_NAV_SURFACES`:
 * every authenticated caller may open it, and the only authority that matters is the token plus the
 * email binding, which the server checks. So it uses `lazyPage`, like `/`, `/settings`,
 * `/notifications` and `/403` — and `src/test/route-permission.contract.test.tsx` permits that,
 * because it only requires the two directions to AGREE (a path in `NAV_PERMISSIONS` must be guarded,
 * a `guardedPage` path must be in the map). Adding an entry to `NON_NAV_SURFACES` would mint a code
 * this surface has no use for and would then require the route to gate on it — turning a fresh
 * member's own invitation link into an Access Denied for the permission they do not have yet, which is
 * precisely the population this page exists to serve.
 *
 * THE TOKEN IS READ FROM `window.location.search`, not from a typed router search schema. No route in
 * this app declares `validateSearch`, and `pages/login/login-page.tsx` — the closest precedent, and
 * the other half of this same flow — reads `returnTo` exactly this way.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AlertCircle, MailCheck } from 'lucide-react'

import { apiErrorCode } from '@/shared/api/api-error'
import { revokeSession } from '@/shared/api/sign-out'
import { useAcceptInvitation } from '@/features/workspaces/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { errorMessage, notify } from '@/shared/lib/toast'
import { Button } from '@/shared/ui/button'
import { Spinner } from '@/shared/ui/spinner'
import { actionFor, refusalFor, type InvitationRefusal } from './model/refusal'
import { InvitationPanel } from './ui/invitation-panel'

export function AcceptInvitationPage() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const signedInEmail = useAuthStore((s) => s.user?.email)

  // Read once. A re-render must not re-derive it from a URL the router may have rewritten by then.
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get('token')?.trim() ?? '',
    [],
  )

  const { mutate, isError, error } = useAcceptInvitation()

  const attempt = useCallback(() => {
    if (!token) return
    mutate(token, {
      onSuccess: () => {
        // Invalidation is NOT here: `meta.invalidates` on the hook drives it through the global
        // `MutationCache`, which is the repo's one place for it (`shared/api/invalidation.ts`) and
        // fires even for an unmounted caller — this page navigates away on success, so a per-observer
        // `onSuccess` invalidation would be racing its own unmount. Cache callbacks run BEFORE the
        // observer's, so `['projects']` is already invalidated by the time we navigate.
        //
        // `/` is enough, and this is why: `AppShell` is the layout for THIS route too, so
        // `useInitialProject` is already mounted and watching the same `useProjects` feed. The
        // invalidation above refetches it, the hook selects the reader's first active project, and the
        // shell's own `projectId` effect then invalidates every project-scoped query. A brand-new
        // member therefore never has to land anywhere special to get a project selected — waiting for
        // it here would duplicate a hook that is already running one layer up.
        notify.success(t('acceptInvitation.joinedToast'))
        void navigate({ to: '/' })
      },
    })
  }, [mutate, navigate, t, token])

  // Fire exactly once per mount. A ref, not a dep list: `mutate` is stable but React 18's
  // StrictMode double-invokes effects in development, and accepting an invitation is not idempotent —
  // the second call would race the first and lose with `INVITATION_ALREADY_USED`, which is a REFUSAL
  // panel shown for a success.
  const attempted = useRef(false)
  useEffect(() => {
    if (attempted.current) return
    attempted.current = true
    attempt()
  }, [attempt])

  async function handleSignOutAndRetry() {
    // End the session, then send the reader back to login WITH this same invitation link as
    // `returnTo`, so signing in as the invited person lands them straight back here and the accept
    // runs for the right account. `isSafeReturnTo` accepts a root-relative path with a query.
    await revokeSession()
    const returnTo = `/accept-invitation?token=${encodeURIComponent(token)}`
    // Cast for the same reason `requireAuth` casts its own `redirect({ to: '/login', search })` in
    // `app/router/router.tsx`: no route in this app declares `validateSearch`, so `/login` has no
    // typed search shape for TanStack to accept an object against. The login page reads `returnTo`
    // from `window.location.search` regardless.
    await navigate({ to: '/login', search: { returnTo } } as unknown as Parameters<
      typeof navigate
    >[0])
  }

  // Absent token first: there is nothing to send, so no request is made and no failure is invented.
  const refusal: InvitationRefusal | null = !token
    ? 'missingToken'
    : isError
      ? refusalFor(apiErrorCode(error))
      : null

  if (refusal === null) {
    // Pending — and also the brief window after a success while the navigation runs. Both are "we are
    // working on it", and neither may render anything that reads as a verdict.
    return (
      <InvitationPanel
        tone="pending"
        icon={<Spinner size="lg" />}
        title={t('acceptInvitation.pendingTitle')}
        description={t('acceptInvitation.pendingDescription')}
      />
    )
  }

  const action = actionFor(refusal)
  return (
    <InvitationPanel
      tone="refused"
      icon={<AlertCircle size={28} className="text-destructive" />}
      title={t(`acceptInvitation.refused.${refusal}.title`)}
      description={t(`acceptInvitation.refused.${refusal}.description`)}
      detail={
        refusal === 'emailMismatch' && signedInEmail
          ? t('acceptInvitation.signedInAs', { email: signedInEmail })
          : refusal === 'unknown'
            ? errorMessage(error, '')
            : undefined
      }
      actions={
        <>
          {action === 'signOut' && (
            <Button onClick={() => void handleSignOutAndRetry()}>
              <MailCheck size={14} />
              {t('acceptInvitation.signOutAndRetry')}
            </Button>
          )}
          {action === 'retry' && <Button onClick={attempt}>{t('common:retry')}</Button>}
          <Button asChild variant="outline">
            <Link to="/">{t('errors:backToHome')}</Link>
          </Button>
        </>
      }
    />
  )
}
