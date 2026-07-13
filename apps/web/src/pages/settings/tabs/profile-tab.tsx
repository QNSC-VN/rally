import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, Loader2, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { BRAND } from '@/shared/config/brand'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useNavigate } from '@tanstack/react-router'
import { Field, Divider, PasswordInput } from './shared'

// ── Profile form schema ───────────────────────────────────────────────────────

const profileSchema = z.object({
  displayName: z.string().min(1, 'Display name is required').max(255).trim(),
  avatarUrl: z.string().optional(),
  locale: z.string().min(2).max(10),
  timezone: z.string().min(1).max(100),
})
type ProfileForm = z.infer<typeof profileSchema>

// ── Password form schema ──────────────────────────────────────────────────────

const PASSWORD_RULES = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[A-Z]/, 'Must include an uppercase letter')
  .regex(/[0-9]/, 'Must include a number')
  .regex(/[^A-Za-z0-9]/, 'Must include a special character')

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: PASSWORD_RULES,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
type PasswordForm = z.infer<typeof passwordSchema>

// ── Profile tab ───────────────────────────────────────────────────────────────

export function ProfileTab() {
  const { user, setUser } = useAuthStore()
  const navigate = useNavigate()
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)

  const profile = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: user?.displayName ?? '',
      avatarUrl: user?.avatarUrl ?? '',
      locale: user?.locale ?? 'en',
      timezone: user?.timezone ?? 'UTC',
    },
  })

  const password = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  async function onSaveProfile(data: ProfileForm) {
    try {
      const body = {
        displayName: data.displayName,
        avatarUrl: data.avatarUrl?.trim() || null,
        locale: data.locale,
        timezone: data.timezone,
      }
      const {
        data: updated,
        error,
        response,
      } = await apiClient.PATCH('/v1/auth/me', {
        body,
      })
      if (error) {
        profile.setError('root', { message: apiErrorMessage(error, response.status) })
        return
      }
      const u = updated as {
        id: string
        email: string
        displayName: string
        avatarUrl: string | null
        locale: string
        timezone: string
        role: string
        permissions: string[]
        emailVerified: boolean
        createdAt: string
        updatedAt: string
        memberships?: unknown[]
      }
      setUser(
        { ...u, avatarUrl: u.avatarUrl ?? undefined, permissions: u.permissions ?? [] },
        (u.memberships as never[]) ?? [],
      )
      toast.success('Profile updated')
    } catch {
      profile.setError('root', { message: 'Network error — please try again.' })
    }
  }

  async function onChangePassword(data: PasswordForm) {
    try {
      const body = { currentPassword: data.currentPassword, newPassword: data.newPassword }
      const customClient = apiClient as unknown as {
        PATCH: (
          url: string,
          options: { body: typeof body }
        ) => Promise<{ error?: unknown; response: { status: number } }>
      }
      const { error, response } = await customClient.PATCH('/v1/auth/password', {
        body,
      })
      if (error) {
        password.setError('root', { message: apiErrorMessage(error, response.status) })
        return
      }
      password.reset()
      setPasswordSaved(true)
      setTimeout(() => setPasswordSaved(false), 3000)
      toast.success('Password changed')
    } catch {
      password.setError('root', { message: 'Network error — please try again.' })
    }
  }

  async function handleLogoutAll() {
    try {
      await apiClient.POST('/v1/auth/logout-all', {})
    } catch {
      /* ignore */
    }
    useAuthStore.getState().clearAuth()
    toast.success('Signed out from all devices')
    await navigate({ to: '/login' })
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ── Profile info ── */}
      <section>
        <h3
          className="mb-4 text-[12px] font-semibold tracking-wide uppercase"
          style={{ color: BRAND.textMuted }}
        >
          Personal Information
        </h3>
        <form
          onSubmit={profile.handleSubmit(onSaveProfile)}
          className="flex max-w-md flex-col gap-4"
        >
          <Field label="Display Name" error={profile.formState.errors.displayName?.message}>
            <input
              {...profile.register('displayName')}
              className="w-full rounded-md px-3 py-2 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
              placeholder="Your display name"
            />
          </Field>
          <Field label="Avatar URL" error={profile.formState.errors.avatarUrl?.message}>
            <input
              {...profile.register('avatarUrl')}
              className="w-full rounded-md px-3 py-2 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
              placeholder="https://..."
            />
          </Field>
          <Field label="Locale">
            <select
              {...profile.register('locale')}
              className="w-full rounded-md bg-white px-3 py-2 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
            >
              <option value="en">English</option>
              <option value="vi">Tiếng Việt</option>
              <option value="ja">日本語</option>
              <option value="zh">中文</option>
            </select>
          </Field>
          <Field label="Timezone">
            <select
              {...profile.register('timezone')}
              className="w-full rounded-md bg-white px-3 py-2 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
            >
              {[
                'UTC',
                'Asia/Ho_Chi_Minh',
                'Asia/Tokyo',
                'America/New_York',
                'America/Los_Angeles',
                'Europe/London',
                'Europe/Paris',
              ].map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Field>
          {profile.formState.errors.root && (
            <p className="text-[12px]" style={{ color: BRAND.danger }}>
              {profile.formState.errors.root.message}
            </p>
          )}
          <div>
            <button
              type="submit"
              disabled={profile.formState.isSubmitting}
              className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: BRAND.primary }}
            >
              {profile.formState.isSubmitting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : null}
              Save changes
            </button>
          </div>
        </form>
      </section>

      <Divider />

      {/* ── Change password ── */}
      <section>
        <h3
          className="mb-4 text-[12px] font-semibold tracking-wide uppercase"
          style={{ color: BRAND.textMuted }}
        >
          Change Password
        </h3>
        <form
          onSubmit={password.handleSubmit(onChangePassword)}
          className="flex max-w-md flex-col gap-4"
        >
          <Field
            label="Current Password"
            error={password.formState.errors.currentPassword?.message}
          >
            <PasswordInput
              show={showCurrent}
              onToggle={() => setShowCurrent(!showCurrent)}
              {...password.register('currentPassword')}
            />
          </Field>
          <Field label="New Password" error={password.formState.errors.newPassword?.message}>
            <PasswordInput
              show={showNew}
              onToggle={() => setShowNew(!showNew)}
              {...password.register('newPassword')}
            />
          </Field>
          <Field
            label="Confirm New Password"
            error={password.formState.errors.confirmPassword?.message}
          >
            <PasswordInput
              show={showConfirm}
              onToggle={() => setShowConfirm(!showConfirm)}
              {...password.register('confirmPassword')}
            />
          </Field>
          {password.formState.errors.root && (
            <p className="text-[12px]" style={{ color: BRAND.danger }}>
              {password.formState.errors.root.message}
            </p>
          )}
          <div>
            <button
              type="submit"
              disabled={password.formState.isSubmitting}
              className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: BRAND.primary }}
            >
              {password.formState.isSubmitting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : passwordSaved ? (
                <Check size={13} />
              ) : null}
              {passwordSaved ? 'Password changed!' : 'Change password'}
            </button>
          </div>
        </form>
      </section>

      <Divider />

      {/* ── Account ── */}
      <section>
        <h3
          className="mb-1 text-[12px] font-semibold tracking-wide uppercase"
          style={{ color: BRAND.textMuted }}
        >
          Account
        </h3>
        <p className="mb-4 text-[12px]" style={{ color: BRAND.textSecondary }}>
          Email:{' '}
          <span className="font-medium" style={{ color: BRAND.textPrimary }}>
            {user?.email}
          </span>
          {user?.emailVerified === false && (
            <span className="ml-2 text-[11px] font-semibold" style={{ color: BRAND.warning }}>
              Not verified
            </span>
          )}
        </p>
        <button
          onClick={() => void handleLogoutAll()}
          className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-medium transition-colors hover:opacity-80"
          style={{
            border: `1px solid ${BRAND.dangerBorder}`,
            color: BRAND.danger,
            backgroundColor: BRAND.dangerBg,
          }}
        >
          <LogOut size={13} />
          Sign out from all devices
        </button>
      </section>
    </div>
  )
}
