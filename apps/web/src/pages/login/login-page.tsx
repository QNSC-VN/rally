import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import {
  Layers,
  ShieldCheck,
  Check,
  Mail,
  LockKeyhole,
  Eye,
  EyeOff,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { scheduleProactiveRefresh, setAccessToken } from '@/shared/api/http-client'
import { ENV, isSsoConfigured } from '@/shared/config/env'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginForm = z.infer<typeof schema>

const API = ENV.API_BASE_URL

/** Guard against open-redirect: only allow same-origin relative paths. */
function safeReturnTo(raw: string | undefined): string {
  if (!raw) return '/'
  const decoded = decodeURIComponent(raw)
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return '/'
  return decoded
}

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
  const [showPassword, setShowPassword] = useState(false)
  const [showEmailForm, setShowEmailForm] = useState(!isSsoConfigured)
  const [ssoLoading, setSsoLoading] = useState(false)
  const [ssoError, setSsoError] = useState<string | null>(null)
  const { setUser } = useAuthStore()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const returnTo = safeReturnTo(search.returnTo)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

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

  async function onSubmit(data: LoginForm) {
    try {
      const res = await fetch(`${API}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({ email: data.email, password: data.password, rememberMe: false }),
      })

      if (res.status === 401 || res.status === 403) {
        setError('root', { message: 'Email or password is incorrect.' })
        return
      }

      if (res.status === 429) {
        setError('root', {
          message: 'Too many login attempts. Please wait a moment and try again.',
        })
        return
      }

      if (!res.ok) {
        setError('root', { message: 'An error occurred. Please try again.' })
        return
      }

      const body = (await res.json()) as {
        accessToken: string
        expiresIn: number
        user: {
          id: string
          email: string
          displayName: string
          avatarUrl?: string | null
          locale: string
          timezone: string
        }
        memberships: {
          tenantId: string
          tenantName: string
          tenantSlug: string
          lastActiveAt: string | null
          roleSlug: string | null
          roleName: string | null
        }[]
      }

      setAccessToken(body.accessToken)
      scheduleProactiveRefresh(body.expiresIn)

      const meRes = await fetch(`${API}/v1/auth/me`, {
        credentials: 'include',
        referrerPolicy: 'no-referrer',
        headers: { Authorization: `Bearer ${body.accessToken}` },
      })
      const fullUser = meRes.ok
        ? ((await meRes.json()) as {
            id: string
            email: string
            displayName: string
            avatarUrl?: string | null
            locale: string
            timezone: string
            role: string
            permissions: string[]
            emailVerified: boolean
            createdAt: string
            updatedAt: string
            memberships: typeof body.memberships
          })
        : {
            ...body.user,
            role: '',
            permissions: [],
            emailVerified: false,
            createdAt: '',
            updatedAt: '',
            memberships: body.memberships,
          }

      setUser(
        { ...fullUser, permissions: fullUser.permissions ?? [] },
        body.accessToken,
        fullUser.memberships ?? body.memberships,
      )
      scheduleProactiveRefresh(body.expiresIn)
      toast.success(`Welcome back, ${body.user.displayName}`)
      await navigate({ to: returnTo as '/' })
    } catch {
      setError('root', { message: 'Network error — check your connection.' })
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
              {/* ── SSO section ──────────────────────────────────────────── */}
              {isSsoConfigured && (
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

                  <div className="my-5 flex items-center gap-3">
                    <div className="h-px flex-1" style={{ backgroundColor: '#edf0f4' }} />
                    <span
                      className="text-[10px] font-medium tracking-widest uppercase"
                      style={{ color: '#b0b8cc' }}
                    >
                      or
                    </span>
                    <div className="h-px flex-1" style={{ backgroundColor: '#edf0f4' }} />
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowEmailForm((v) => !v)}
                    className="flex w-full items-center justify-between rounded px-3 py-2 text-[11px] font-medium transition-colors"
                    style={{ color: '#5c6478', backgroundColor: '#f8f9fb' }}
                  >
                    <span>Sign in with email &amp; password</span>
                    {showEmailForm ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                </>
              )}

              {/* ── Email / password form ─────────────────────────────────── */}
              {showEmailForm && (
                <form
                  onSubmit={handleSubmit(onSubmit)}
                  className={isSsoConfigured ? 'mt-4' : ''}
                  noValidate
                >
                  {errors.root && (
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
                      {errors.root.message}
                    </div>
                  )}

                  <label
                    className="mb-1.5 block text-[10px] font-semibold tracking-widest uppercase"
                    style={{ color: '#5c6478' }}
                    htmlFor="email"
                  >
                    Email address
                  </label>
                  <div className="relative mb-1">
                    <Mail
                      size={14}
                      className="absolute top-1/2 left-3 -translate-y-1/2"
                      style={{ color: '#8c94a6' }}
                    />
                    <input
                      id="email"
                      type="email"
                      autoComplete="username"
                      {...register('email')}
                      className="w-full rounded py-2.5 pr-3 pl-9 text-[12px] focus:ring-2 focus:outline-none"
                      style={{
                        border: errors.email ? '1px solid #e2534a' : '1px solid #d9dee7',
                        color: '#1a2234',
                      }}
                    />
                  </div>
                  {errors.email && (
                    <p className="mb-3 text-[11px]" style={{ color: '#b91c1c' }}>
                      {errors.email.message}
                    </p>
                  )}

                  <div className="mt-4 mb-1.5 flex items-center justify-between">
                    <label
                      className="text-[10px] font-semibold tracking-widest uppercase"
                      style={{ color: '#5c6478' }}
                      htmlFor="password"
                    >
                      Password
                    </label>
                    <Link
                      to="/forgot-password"
                      className="text-[10px] font-medium"
                      style={{ color: '#2558a6' }}
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative mb-1">
                    <LockKeyhole
                      size={14}
                      className="absolute top-1/2 left-3 -translate-y-1/2"
                      style={{ color: '#8c94a6' }}
                    />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      {...register('password')}
                      className="w-full rounded py-2.5 pr-10 pl-9 text-[12px] focus:ring-2 focus:outline-none"
                      style={{
                        border: errors.password ? '1px solid #e2534a' : '1px solid #d9dee7',
                        color: '#1a2234',
                      }}
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute top-1/2 right-2.5 -translate-y-1/2 p-1"
                      style={{ color: '#8c94a6' }}
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="mb-3 text-[11px]" style={{ color: '#b91c1c' }}>
                      {errors.password.message}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="mt-5 w-full rounded py-2.5 text-[13px] font-semibold text-white transition-opacity disabled:opacity-60"
                    style={{ backgroundColor: '#1d3f73' }}
                  >
                    {isSubmitting ? 'Signing in…' : 'Sign in'}
                  </button>
                </form>
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
