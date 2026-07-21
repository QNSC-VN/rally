import { BRAND } from '@/shared/config/brand'
import { useState } from 'react'
import { Layers, ShieldCheck, Check, AlertCircle } from 'lucide-react'
import { ENV } from '@/shared/config/env'

// ── Microsoft logo SVG (official 4-square mark) ────────────────────────────
function MicrosoftLogo() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 21 21"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

export function LoginPage() {
  const [ssoLoading, setSsoLoading] = useState(false)
  const [ssoError, setSsoError] = useState<string | null>(null)
  const [devEmail, setDevEmail] = useState('admin@acme.dev')
  const [devLoading, setDevLoading] = useState(false)
  const [devError, setDevError] = useState<string | null>(null)

  // ── SSO handler ────────────────────────────────────────────────────
  async function handleSsoLogin() {
    setSsoLoading(true)
    setSsoError(null)
    try {
      // Same-origin BFF: hand off to the server-side login route. The browser
      // navigates to Entra and returns with a session cookie already set — no
      // in-browser tokens. Execution stops at the redirect.
      const returnTo = new URLSearchParams(window.location.search).get('returnTo') ?? '/'
      window.location.href = `/v1/bff/login?returnTo=${encodeURIComponent(returnTo)}`
    } catch {
      setSsoError('Could not initiate sign-in. Please try again.')
      setSsoLoading(false)
    }
  }

  // ── Dev sign-in (non-SSO environments only) ─────────────────────────────
  async function handleDevLogin(e: React.FormEvent) {
    e.preventDefault()
    setDevLoading(true)
    setDevError(null)
    try {
      // The session lands on the server (same-origin /v1/bff); the browser holds
      // no tokens.
      const endpoint = '/v1/bff/dev-login'
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: devEmail }),
      })
      if (!res.ok) {
        setDevError('Login failed. Check the email is a seeded account and the API is running.')
        setDevLoading(false)
        return
      }
      // Full reload — bootstrapAuth() restores the session from the refresh cookie.
      window.location.assign('/')
    } catch {
      setDevError('Could not reach the API. Is it running on :3000?')
      setDevLoading(false)
    }
  }

  const features = ['Workspace control', 'Project visibility', 'Team governance']

  return (
    <main
      className="grid min-h-svh bg-background lg:grid-cols-[minmax(420px,0.9fr)_minmax(560px,1.1fr)]"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* ── Left panel ─────────────────────────────────────────────────────── */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-white lg:flex xl:p-14">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 15% 20%, #8cb3e8 0, transparent 28%), radial-gradient(circle at 85% 82%, #5b83bd 0, transparent 32%)',
          }}
        />
        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-md"
            style={{
              backgroundColor: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.18)',
            }}
          >
            <Layers size={19} />
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight">Mini Rally</div>
            <div className="text-ui-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Work Management Platform
            </div>
          </div>
        </div>

        {/* Hero copy */}
        <div className="relative max-w-xl">
          <div
            className="mb-5 inline-flex items-center gap-1.5 rounded px-2 py-1 text-ui-xs font-semibold tracking-widest uppercase"
            style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.78)' }}
          >
            <ShieldCheck size={12} />
            Workspace Administration
          </div>
          <h1 className="text-3xl leading-tight font-semibold tracking-tight xl:text-4xl">
            Plan clearly.
            <br />
            Deliver with confidence.
          </h1>
          <p
            className="mt-4 max-w-md text-ui-xl leading-6"
            style={{ color: 'rgba(255,255,255,0.66)' }}
          >
            Manage company workspaces, projects, teams and delivery from one focused operating view.
          </p>
          <div className="mt-8 grid max-w-lg grid-cols-3 gap-3">
            {features.map((f) => (
              <div
                key={f}
                className="flex items-center gap-2 text-ui-sm"
                style={{ color: 'rgba(255,255,255,0.74)' }}
              >
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full"
                  style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
                >
                  <Check size={9} />
                </span>
                {f}
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-ui-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
          © 2026 Mini Rally · Internal workspace
        </div>
      </section>

      {/* ── Right panel ────────────────────────────────────────────────────── */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[430px]">
          {/* Mobile logo */}
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-white">
              <Layers size={16} />
            </div>
            <div>
              <div className="text-ui-xl font-semibold text-foreground">Mini Rally</div>
              <div className="text-ui-2xs text-foreground-subtle">Work Management Platform</div>
            </div>
          </div>

          {/* Card */}
          <div className="overflow-hidden rounded-md border border-border-strong bg-card shadow-sm">
            {/* Card header */}
            <div className="border-b border-border-inner px-7 pt-7 pb-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="mb-1 text-ui-xs font-semibold tracking-widest text-foreground-subtle uppercase">
                    Admin access
                  </p>
                  <h2 className="text-xl font-semibold tracking-tight text-foreground">
                    Sign in to Mini Rally
                  </h2>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-lighter text-primary">
                  <ShieldCheck size={19} />
                </div>
              </div>
              <p className="mt-2 text-ui-md text-muted-foreground">
                Use your organisational account to continue.
              </p>
            </div>

            <div className="px-7 py-6">
              {/* ── SSO sign-in ──────────────────────────────────────────── */}
              {ssoError && (
                <div
                  role="alert"
                  className="mb-4 flex items-start gap-2 rounded border border-destructive-border bg-destructive-bg px-3 py-2.5 text-ui-sm text-destructive"
                >
                  <AlertCircle size={14} className="mt-px shrink-0" />
                  {ssoError}
                </div>
              )}

              <button
                type="button"
                onClick={handleSsoLogin}
                disabled={ssoLoading}
                className="flex w-full items-center justify-center gap-3 rounded border border-border-strong bg-card py-3 text-ui-lg font-medium text-foreground transition-colors disabled:opacity-60"
                style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = BRAND.surfaceSubtle
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = BRAND.surface
                }}
              >
                {ssoLoading ? (
                  <span
                    className="h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-primary"
                    aria-label="Signing in…"
                  />
                ) : (
                  <MicrosoftLogo />
                )}
                {ssoLoading ? 'Redirecting to Microsoft…' : 'Sign in with Microsoft'}
              </button>
              {/* ── Dev sign-in ─────────────────────────────────────────────
                  Shown when VITE_DEV_LOGIN=true (any non-prod deployment), so QA
                  exercises the identical same-origin session flow without an
                  Entra tenant. Never enabled in production. */}
              {ENV.DEV_LOGIN_ENABLED && (
                <form onSubmit={handleDevLogin} className="flex flex-col gap-4">
                  <p className="text-ui-md text-muted-foreground">
                    Development only: sign in with a seeded account (mints a server-side BFF
                    session).
                  </p>

                  {devError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded border border-destructive-border bg-destructive-bg px-3 py-2.5 text-ui-sm text-destructive"
                    >
                      <AlertCircle size={14} className="mt-px shrink-0" />
                      {devError}
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="dev-email"
                      className="text-ui-sm font-medium text-muted-foreground"
                    >
                      Email
                    </label>
                    <input
                      id="dev-email"
                      type="email"
                      required
                      value={devEmail}
                      onChange={(e) => setDevEmail(e.target.value)}
                      className="h-10 w-full rounded border border-border-strong px-3 text-ui-lg text-foreground outline-none"
                      placeholder="you@acme.dev"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={devLoading}
                    className="flex w-full items-center justify-center gap-2 rounded bg-primary py-3 text-ui-lg font-medium text-white transition-colors disabled:opacity-60"
                  >
                    {devLoading ? 'Signing in…' : 'Sign in'}
                  </button>
                </form>
              )}
            </div>
          </div>

          <p className="mt-5 text-center text-ui-xs text-foreground-subtle">
            Need access?{' '}
            <a href="mailto:admin@minirallyapp.com" className="font-medium text-primary-light">
              Contact your administrator
            </a>
          </p>
        </div>
      </section>
    </main>
  )
}
