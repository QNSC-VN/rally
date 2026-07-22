import { useForm, Controller } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, LogOut } from 'lucide-react'

import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useNavigate } from '@tanstack/react-router'
import { notify } from '@/shared/lib/toast'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { SearchableSelect } from '@/shared/ui/searchable-select'

type ProfileForm = {
  displayName: string
  avatarUrl?: string
  locale: string
  timezone: string
  phone?: string
}

const TIMEZONES = [
  'UTC',
  'Asia/Ho_Chi_Minh',
  'Asia/Tokyo',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
]

/** Uppercase section label used across the profile sections. */
function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3
      className={`text-ui-md font-semibold tracking-wide text-foreground-subtle uppercase ${className ?? ''}`}
    >
      {children}
    </h3>
  )
}

export function ProfileTab() {
  const { t } = useTranslation('settings')
  const { user, setUser } = useAuthStore()
  const navigate = useNavigate()

  const profileSchema = z.object({
    displayName: z.string().min(1, t('profile.displayNameRequired')).max(255).trim(),
    avatarUrl: z.string().optional(),
    locale: z.string().min(2).max(10),
    timezone: z.string().min(1).max(100),
    phone: z.string().max(32).trim().optional(),
  })

  const profile = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: user?.displayName ?? '',
      avatarUrl: user?.avatarUrl ?? '',
      locale: user?.locale ?? 'en',
      timezone: user?.timezone ?? 'UTC',
      phone: user?.phone ?? '',
    },
  })

  async function onSaveProfile(data: ProfileForm) {
    try {
      const body = {
        displayName: data.displayName,
        avatarUrl: data.avatarUrl?.trim() || null,
        locale: data.locale,
        timezone: data.timezone,
        phone: data.phone?.trim() || null,
      }
      const { data: updated, error, response } = await apiClient.PATCH('/v1/auth/me', { body })
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
        phone: string | null
        role: string
        permissions: string[]
        emailVerified: boolean
        createdAt: string
        updatedAt: string
      }
      setUser(
        { ...u, avatarUrl: u.avatarUrl ?? undefined, permissions: u.permissions ?? [] },
        useAuthStore.getState().memberships,
      )
      notify.success(t('profile.profileUpdated'))
    } catch {
      profile.setError('root', { message: t('profile.networkError') })
    }
  }

  async function handleLogoutAll() {
    try {
      await apiClient.POST('/v1/auth/logout-all', {})
    } catch {
      /* ignore */
    }
    useAuthStore.getState().clearAuth()
    notify.success(t('profile.signedOutAll'))
    await navigate({ to: '/login' })
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ── Profile info ── */}
      <section>
        <SectionTitle className="mb-4">{t('profile.personalInfo')}</SectionTitle>
        <form
          onSubmit={profile.handleSubmit(onSaveProfile)}
          className="flex max-w-md flex-col gap-4"
        >
          <FormField
            label={t('profile.displayNameLabel')}
            error={profile.formState.errors.displayName?.message}
          >
            <Input {...profile.register('displayName')} placeholder="Your display name" />
          </FormField>
          <FormField
            label={t('profile.avatarUrlLabel')}
            error={profile.formState.errors.avatarUrl?.message}
          >
            <Input {...profile.register('avatarUrl')} placeholder="https://..." />
          </FormField>
          <FormField
            label={t('profile.phoneLabel')}
            error={profile.formState.errors.phone?.message}
          >
            <Input {...profile.register('phone')} placeholder="+84 ..." />
          </FormField>
          <FormField label={t('profile.localeLabel')}>
            <Controller
              control={profile.control}
              name="locale"
              render={({ field }) => (
                <SearchableSelect
                  variant="field"
                  value={field.value ?? ''}
                  ariaLabel={t('profile.localeLabel')}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'vi', label: 'Tiếng Việt' },
                    { value: 'ja', label: '日本語' },
                    { value: 'zh', label: '中文' },
                  ]}
                  onChange={field.onChange}
                />
              )}
            />
          </FormField>
          <FormField label={t('profile.timezoneLabel')}>
            <Controller
              control={profile.control}
              name="timezone"
              render={({ field }) => (
                <SearchableSelect
                  variant="field"
                  value={field.value ?? ''}
                  ariaLabel={t('profile.timezoneLabel')}
                  options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
                  onChange={field.onChange}
                />
              )}
            />
          </FormField>
          {profile.formState.errors.root && (
            <p className="text-ui-md text-destructive">{profile.formState.errors.root.message}</p>
          )}
          <div>
            <Button type="submit" disabled={profile.formState.isSubmitting}>
              {profile.formState.isSubmitting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : null}
              {t('saveChanges')}
            </Button>
          </div>
        </form>
      </section>

      <hr className="border-border-subtle" />

      {/* ── Password & security ── */}
      <section>
        <SectionTitle className="mb-2">{t('profile.passwordSecurity')}</SectionTitle>
        <p className="max-w-md text-ui-md text-muted-foreground">
          {t('profile.passwordSecurityNote')}
        </p>
      </section>

      <hr className="border-border-subtle" />

      {/* ── Account ── */}
      <section>
        <SectionTitle className="mb-1">{t('profile.account')}</SectionTitle>
        <p className="mb-4 text-ui-md text-muted-foreground">
          {t('profile.emailLabel')}{' '}
          <span className="font-medium text-foreground">{user?.email}</span>
          {user?.emailVerified === false && (
            <span className="ml-2 text-ui-sm font-semibold text-warning">
              {t('profile.notVerified')}
            </span>
          )}
        </p>
        <Button variant="destructive" onClick={() => void handleLogoutAll()}>
          <LogOut size={13} />
          {t('profile.signOutAll')}
        </Button>
      </section>
    </div>
  )
}
