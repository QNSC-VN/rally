import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import {
  Layers,
  ShieldCheck,
  Check,
  LockKeyhole,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { ENV } from '@/shared/config/env'

type TokenState = 'checking' | 'valid' | 'invalid' | 'expired' | 'used'

const PASSWORD_RULES = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128, 'Maximum 128 characters')
  .regex(/[A-Z]/, 'Must include at least one uppercase letter')
  .regex(/[0-9]/, 'Must include at least one number')
  .regex(/[^A-Za-z0-9]/, 'Must include at least one special character')

const schema = z
  .object({
    newPassword: PASSWORD_RULES,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type ResetPasswordForm = z.infer<typeof schema>

const API = ENV.API_BASE_URL

const features = ['Workspace control', 'Project visibility', 'Team governance']

export function ResetPasswordPage() {
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const navigate = useNavigate()

  // Read token from ?token= query param
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const token = search.token ?? ''

  // Derive initial state from token presence — avoids setState inside effect body
  const [tokenState, setTokenState] = useState<TokenState>(() => (token ? 'checking' : 'invalid'))

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetch(`${API}/v1/auth/verify-reset-token?token=${encodeURIComponent(token)}`, {
      referrerPolicy: 'no-referrer',
    })
      .then((r) => r.json() as Promise<{ valid: boolean; reason?: 'invalid' | 'expired' | 'used' }>)
      .then((body) => {
        if (cancelled) return
        if (body.valid) {
          setTokenState('valid')
        } else {
          setTokenState(body.reason ?? 'invalid')
        }
      })
      .catch(() => {
        if (!cancelled) setTokenState('invalid')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordForm>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  })

  async function onSubmit(data: ResetPasswordForm) {
    try {
      const res = await fetch(`${API}/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({ token, newPassword: data.newPassword }),
      })

      if (res.status === 401) {
        const body = (await res.json()) as { code?: string }
        if (body.code === 'PASSWORD_RESET_TOKEN_EXPIRED') {
          setError('root', {
            message: 'This reset link has expired. Please request a new one.',
          })
        } else {
          setError('root', {
            message: 'This reset link is invalid or has already been used.',
          })
        }
        return
      }

      if (res.status === 422) {
        setError('newPassword', { message: 'Password does not meet the requirements.' })
        return
      }

      if (res.status === 429) {
        setError('root', {
          message: 'Too many attempts. Please wait a moment before trying again.',
        })
        return
      }

      if (!res.ok) {
        setError('root', { message: 'An error occurred. Please try again.' })
        return
      }

      setSucceeded(true)
      toast.success('Password reset. Please sign in with your new password.')
      setTimeout(() => navigate({ to: '/login' }), 2000)
    } catch {
      setError('root', { message: 'Network error — check your connection.' })
    }
  }

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
            <div className="text-[16px] font-semibold tracking-tight">Rally</div>
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
          © 2026 Rally · Internal workspace
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
                Rally
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
                    Account recovery
                  </p>
                  <h2
                    className="text-[21px] font-semibold tracking-tight"
                    style={{ color: '#1a2234' }}
                  >
                    Set new password
                  </h2>
                </div>
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: '#edf2fb', color: '#1d3f73' }}
                >
                  <LockKeyhole size={19} />
                </div>
              </div>
            </div>

            {/* Token state router */}
            {tokenState === 'checking' ? (
              /* ── Validating token on mount ── */
              <div className="flex flex-col items-center px-7 py-10 text-center">
                <Loader2 size={24} className="mb-3 animate-spin" style={{ color: '#1d3f73' }} />
                <p className="text-[12px]" style={{ color: '#5c6478' }}>
                  Validating your reset link…
                </p>
              </div>
            ) : tokenState === 'expired' ? (
              /* ── Token expired ── */
              <div className="px-7 py-8 text-center">
                <AlertCircle size={28} className="mx-auto mb-3" style={{ color: '#d97706' }} />
                <p className="mb-1 text-[13px] font-semibold" style={{ color: '#1a2234' }}>
                  Reset link has expired
                </p>
                <p className="mb-5 text-[12px]" style={{ color: '#5c6478' }}>
                  Password reset links are valid for a limited time. Please request a new one.
                </p>
                <Link
                  to="/forgot-password"
                  className="inline-block rounded px-4 py-2 text-[12px] font-semibold text-white"
                  style={{ backgroundColor: '#1d3f73' }}
                >
                  Request a new link
                </Link>
              </div>
            ) : tokenState === 'used' ? (
              /* ── Token already used ── */
              <div className="px-7 py-8 text-center">
                <CheckCircle2 size={28} className="mx-auto mb-3" style={{ color: '#2a8c3f' }} />
                <p className="mb-1 text-[13px] font-semibold" style={{ color: '#1a2234' }}>
                  Password already reset
                </p>
                <p className="mb-5 text-[12px]" style={{ color: '#5c6478' }}>
                  This link has already been used. Sign in with your new password.
                </p>
                <Link
                  to="/login"
                  className="inline-block rounded px-4 py-2 text-[12px] font-semibold text-white"
                  style={{ backgroundColor: '#1d3f73' }}
                >
                  Sign in
                </Link>
              </div>
            ) : tokenState === 'invalid' ? (
              /* ── Token missing / malformed ── */
              <div className="px-7 py-8 text-center">
                <AlertCircle size={28} className="mx-auto mb-3" style={{ color: '#e2534a' }} />
                <p className="mb-1 text-[13px] font-semibold" style={{ color: '#1a2234' }}>
                  Invalid reset link
                </p>
                <p className="mb-5 text-[12px]" style={{ color: '#5c6478' }}>
                  This link is invalid or has already been used. Please request a new one.
                </p>
                <Link
                  to="/forgot-password"
                  className="inline-block rounded px-4 py-2 text-[12px] font-semibold text-white"
                  style={{ backgroundColor: '#1d3f73' }}
                >
                  Request new link
                </Link>
              </div>
            ) : succeeded ? (
              /* ── Success state ── */
              <div className="px-7 py-8 text-center">
                <div
                  className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
                  style={{ backgroundColor: '#f0faf4' }}
                >
                  <CheckCircle2 size={24} style={{ color: '#2a8c3f' }} />
                </div>
                <p className="mb-2 text-[13px] font-semibold" style={{ color: '#1a2234' }}>
                  Password updated
                </p>
                <p className="text-[12px]" style={{ color: '#5c6478' }}>
                  Redirecting to sign in…
                </p>
              </div>
            ) : (
              /* ── Form ── */
              <form onSubmit={handleSubmit(onSubmit)} className="px-7 py-6" noValidate>
                <p className="mb-5 text-[12px] leading-5" style={{ color: '#5c6478' }}>
                  Choose a strong password. It must be at least 8 characters and include an
                  uppercase letter, a number, and a special character.
                </p>

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

                {/* New password */}
                <label
                  className="mb-1.5 block text-[10px] font-semibold tracking-widest uppercase"
                  style={{ color: '#5c6478' }}
                  htmlFor="newPassword"
                >
                  New password
                </label>
                <div className="relative mb-1">
                  <LockKeyhole
                    size={14}
                    className="absolute top-1/2 left-3 -translate-y-1/2"
                    style={{ color: '#8c94a6' }}
                  />
                  <input
                    id="newPassword"
                    type={showNew ? 'text' : 'password'}
                    autoComplete="new-password"
                    autoFocus
                    {...register('newPassword')}
                    className="w-full rounded py-2.5 pr-10 pl-9 text-[12px] focus:ring-2 focus:outline-none"
                    style={{
                      border: errors.newPassword ? '1px solid #e2534a' : '1px solid #d9dee7',
                      color: '#1a2234',
                    }}
                  />
                  <button
                    type="button"
                    aria-label={showNew ? 'Hide password' : 'Show password'}
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 p-1"
                    style={{ color: '#8c94a6' }}
                  >
                    {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {errors.newPassword && (
                  <p className="mb-3 text-[11px]" style={{ color: '#b91c1c' }}>
                    {errors.newPassword.message}
                  </p>
                )}

                {/* Confirm password */}
                <label
                  className="mt-4 mb-1.5 block text-[10px] font-semibold tracking-widest uppercase"
                  style={{ color: '#5c6478' }}
                  htmlFor="confirmPassword"
                >
                  Confirm new password
                </label>
                <div className="relative mb-1">
                  <LockKeyhole
                    size={14}
                    className="absolute top-1/2 left-3 -translate-y-1/2"
                    style={{ color: '#8c94a6' }}
                  />
                  <input
                    id="confirmPassword"
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    {...register('confirmPassword')}
                    className="w-full rounded py-2.5 pr-10 pl-9 text-[12px] focus:ring-2 focus:outline-none"
                    style={{
                      border: errors.confirmPassword ? '1px solid #e2534a' : '1px solid #d9dee7',
                      color: '#1a2234',
                    }}
                  />
                  <button
                    type="button"
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 p-1"
                    style={{ color: '#8c94a6' }}
                  >
                    {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className="mb-3 text-[11px]" style={{ color: '#b91c1c' }}>
                    {errors.confirmPassword.message}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-5 w-full rounded py-2.5 text-[12px] font-semibold text-white transition-opacity disabled:opacity-60"
                  style={{ backgroundColor: '#1d3f73' }}
                >
                  {isSubmitting ? 'Updating…' : 'Update password'}
                </button>

                <div className="mt-4 text-center">
                  <Link
                    to="/login"
                    className="text-[11px] font-medium"
                    style={{ color: '#2558a6' }}
                  >
                    ← Back to sign in
                  </Link>
                </div>
              </form>
            )}
          </div>

          <div
            className="mt-5 flex items-center justify-center gap-4 text-[10px]"
            style={{ color: '#8c94a6' }}
          >
            <button type="button">Privacy</button>
            <span>·</span>
            <button type="button">Support</button>
            <span>·</span>
            <span>v0.1.0</span>
          </div>
        </div>
      </section>
    </main>
  )
}
