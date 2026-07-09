import { useState } from 'react'
import { Layers, ShieldCheck, Check, AlertCircle } from 'lucide-react'
import { isSsoConfigured } from '@/shared/config/env'

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

  // ── SSO handler ───────────────────────────────────────────────────────────
  async function handleSsoLogin() {
    setSsoLoading(true)
    setSsoError(null)
    try {
      // eslint-disable-next-line boundaries/dependencies
      const { triggerSsoLogin } = await import('@/app/auth/msal')
      await triggerSsoLogin()
      // Page redirects to Microsoft — execution stops here
    } catch {
      setSsoError('Could not initiate sign-in. Please try again.')
      setSsoLoading(false)
    }
  }

  const features = ['Workspace control', 'Project visibility', 'Team governance']

  return (
    <main
      className="grid min-h-svh lg:grid-cols-[minmax(420px,0.9fr)_minmax(560px,1.1fr)]"
      style={{ fontFamily: "'Inter', system-ui, sans-serif", backgroundColor: '#f0f2f5' }}
    >
      {/* ── Left panel ─────────────────────────────────────────────────────── */}
      <section
        className="relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex xl:p-14"
        style={{ backgroundColor: '#1d3f73' }}
      >
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
            <div className="text-[16px] font-semibold tracking-tight">Mini Rally</div>
            <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Work Management Platform
            </div>
          </div>
        </div>

        {/* Hero copy */}
        <div className="relative max-w-xl">
          <div
            className="mb-5 inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-semibold tracking-widest uppercase"
            style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.78)' }}
          >
            <ShieldCheck size={12} />
            Workspace Administration
          </div>
          <h1 className="text-[32px] leading-tight font-semibold tracking-tight xl:text-[38px]">
            Plan clearly.
            <br />
            Deliver with confidence.
          </h1>
          <p
            className="mt-4 max-w-md text-[14px] leading-6"
            style={{ color: 'rgba(255,255,255,0.66)' }}
          >
            Manage company workspaces, projects, teams and delivery from one focused operating view.
          </p>
          <div className="mt-8 grid max-w-lg grid-cols-3 gap-3">
            {features.map((f) => (
              <div
                key={f}
                className="flex items-center gap-2 text-[11px]"
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

        <div className="relative text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
          © 2026 Mini Rally · Internal workspace
        </div>
      </section>

      {/* ── Right panel ────────────────────────────────────────────────────── */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[430px]">
          {/* Mobile logo */}
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div
              className="flex h-8 w-8 items-center justify-center rounded text-white"
              style={{ backgroundColor: '#1d3f73' }}
            >
              <Layers size={16} />
            </div>
            <div>
              <div className="text-[14px] font-semibold" style={{ color: '#1a2234' }}>
                Mini Rally
              </div>
              <div className="text-[9px]" style={{ color: '#8c94a6' }}>
                Work Management Platform
              </div>
            </div>
          </div>

          {/* Card */}
          <div
            className="overflow-hidden rounded-md bg-white shadow-sm"
            style={{ border: '1px solid #d9dee7' }}
          >
            {/* Card header */}
            <div className="px-7 pt-7 pb-5" style={{ borderBottom: '1px solid #edf0f4' }}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p
                    className="mb-1 text-[10px] font-semibold tracking-widest uppercase"
                    style={{ color: '#8c94a6' }}
                  >
                    Admin access
                  </p>
                  <h2
                    className="text-[21px] font-semibold tracking-tight"
                    style={{ color: '#1a2234' }}
                  >
                    Sign in to Mini Rally
                  </h2>
                </div>
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: '#edf2fb', color: '#1d3f73' }}
                >
                  <ShieldCheck size={19} />
                </div>
              </div>
              <p className="mt-2 text-[12px]" style={{ color: '#5c6478' }}>
                {isSsoConfigured
                  ? 'Use your organisational account to continue.'
                  : 'Use your Workspace Admin account to continue.'}
              </p>
            </div>

            <div className="px-7 py-6">
              {/* ── SSO sign-in ──────────────────────────────────────────── */}
              {isSsoConfigured ? (
                <>
                  {ssoError && (
                    <div
                      role="alert"
                      className="mb-4 flex items-start gap-2 rounded px-3 py-2.5 text-[11px]"
                      style={{
                        color: '#b91c1c',
                        backgroundColor: '#fef2f2',
                        border: '1px solid #f0c7c1',
                      }}
                    >
                      <AlertCircle size={14} className="mt-px shrink-0" />
                      {ssoError}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSsoLogin}
                    disabled={ssoLoading}
                    className="flex w-full items-center justify-center gap-3 rounded py-3 text-[13px] font-medium transition-colors disabled:opacity-60"
                    style={{
                      backgroundColor: '#fff',
                      border: '1px solid #d9dee7',
                      color: '#1a2234',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#f5f7fa'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#fff'
                    }}
                  >
                    {ssoLoading ? (
                      <span
                        className="h-5 w-5 animate-spin rounded-full"
                        style={{ border: '2px solid #d9dee7', borderTopColor: '#1d3f73' }}
                        aria-label="Signing in…"
                      />
                    ) : (
                      <MicrosoftLogo />
                    )}
                    {ssoLoading ? 'Redirecting to Microsoft…' : 'Sign in with Microsoft'}
                  </button>
                </>
              ) : (
                <p className="text-[12px]" style={{ color: '#5c6478' }}>
                  Single sign-on is not configured for this environment. Contact your administrator.
                </p>
              )}
            </div>
          </div>

          <p className="mt-5 text-center text-[10px]" style={{ color: '#8c94a6' }}>
            Need access?{' '}
            <a
              href="mailto:admin@minirallyapp.com"
              className="font-medium"
              style={{ color: '#2558a6' }}
            >
              Contact your administrator
            </a>
          </p>
        </div>
      </section>
    </main>
  )
}
