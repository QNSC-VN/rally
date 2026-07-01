import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from '@tanstack/react-router'
import {
  Layers,
  ShieldCheck,
  Check,
  Mail,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react'
import { ENV } from '@/shared/config/env'

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
})

type ForgotPasswordForm = z.infer<typeof schema>

const API = ENV.API_BASE_URL

const features = ['Workspace control', 'Project visibility', 'Team governance']

export function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  })

  async function onSubmit(data: ForgotPasswordForm) {
    try {
      const res = await fetch(`${API}/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({ email: data.email }),
      })

      if (res.status === 429) {
        setError('root', { message: 'Too many requests. Please wait a moment and try again.' })
        return
      }

      // AUTH-FR-007: always show success regardless of whether email was found
      const body = (await res.json()) as { message: string; devResetUrl?: string }
      if (body.devResetUrl) {
        setDevResetUrl(body.devResetUrl)
      }
      setSubmitted(true)
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
                    Account recovery
                  </p>
                  <h2
                    className="text-[21px] font-semibold tracking-tight"
                    style={{ color: '#1a2234' }}
                  >
                    Reset your password
                  </h2>
                </div>
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: '#edf2fb', color: '#1d3f73' }}
                >
                  <Mail size={19} />
                </div>
              </div>
            </div>

            {/* Content */}
            {submitted ? (
              /* ── Success state ── */
              <div className="px-7 py-8">
                <div className="mb-5 flex flex-col items-center text-center">
                  <div
                    className="mb-4 flex h-12 w-12 items-center justify-center rounded-full"
                    style={{ backgroundColor: '#f0faf4' }}
                  >
                    <CheckCircle2 size={24} style={{ color: '#2a8c3f' }} />
                  </div>
                  <p className="text-[13px] font-semibold" style={{ color: '#1a2234' }}>
                    Check your email
                  </p>
                  <p className="mt-2 text-[12px] leading-5" style={{ color: '#5c6478' }}>
                    If{' '}
                    <span className="font-medium" style={{ color: '#1a2234' }}>
                      {getValues('email')}
                    </span>{' '}
                    is registered, you'll receive a password reset link shortly.
                  </p>
                </div>

                {/* Dev-mode banner — never shown in production */}
                {devResetUrl && (
                  <div
                    className="mb-5 rounded p-3 text-[11px]"
                    style={{ backgroundColor: '#fffbeb', border: '1px solid #f0c040' }}
                  >
                    <p className="mb-1.5 font-semibold" style={{ color: '#92400e' }}>
                      Development mode — reset link
                    </p>
                    <a
                      href={devResetUrl}
                      className="inline-flex items-center gap-1 font-mono text-[10px] break-all underline"
                      style={{ color: '#1d3f73' }}
                    >
                      {devResetUrl}
                      <ExternalLink size={10} className="shrink-0" />
                    </a>
                  </div>
                )}

                <Link
                  to="/login"
                  className="block w-full rounded py-2.5 text-center text-[12px] font-semibold text-white transition-opacity"
                  style={{ backgroundColor: '#1d3f73' }}
                >
                  Back to sign in
                </Link>
              </div>
            ) : (
              /* ── Form ── */
              <form onSubmit={handleSubmit(onSubmit)} className="px-7 py-6" noValidate>
                <p className="mb-5 text-[12px] leading-5" style={{ color: '#5c6478' }}>
                  Enter your email address and we'll send you a link to reset your password.
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
                    autoComplete="email"
                    autoFocus
                    {...register('email')}
                    className="w-full rounded py-2.5 pr-3 pl-9 text-[12px] focus:ring-2 focus:outline-none"
                    style={{
                      border: errors.email ? '1px solid #e2534a' : '1px solid #d9dee7',
                      color: '#1a2234',
                    }}
                    placeholder="admin@acme.dev"
                  />
                </div>
                {errors.email && (
                  <p className="mb-3 text-[11px]" style={{ color: '#b91c1c' }}>
                    {errors.email.message}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-5 w-full rounded py-2.5 text-[12px] font-semibold text-white transition-opacity disabled:opacity-60"
                  style={{ backgroundColor: '#1d3f73' }}
                >
                  {isSubmitting ? 'Sending…' : 'Send reset link'}
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
