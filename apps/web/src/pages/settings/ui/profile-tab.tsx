import { useForm, Controller, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, LogOut } from 'lucide-react'

import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { setFormatPrefs, resolveFormatPrefs } from '@/shared/lib/format-prefs'
import { TIMEZONES, LOCALES } from '@/shared/config/formatting-options'

type WorkspaceDefaults = { locale: string | null; timezone: string | null } | null
import { useNavigate } from '@tanstack/react-router'
import { notify } from '@/shared/lib/toast'
import { Button } from '@/shared/ui/button'
import { Card, CardHeader, CardBody } from '@/shared/ui/card'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { SearchableSelect } from '@/shared/ui/searchable-select'
import { AvatarUploader } from './avatar-uploader'

type ProfileForm = {
  displayName: string
  avatarUrl?: string
  locale: string
  timezone: string
  phone?: string
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

  // Live values that drive the avatar preview (memoization-safe vs `watch()`).
  const watchedName = useWatch({ control: profile.control, name: 'displayName' })
  const watchedAvatar = useWatch({ control: profile.control, name: 'avatarUrl' })

  // Reflect a fresh `/auth/me` payload into the auth store — shared by the
  // profile save and the avatar uploader.
  function applyUpdatedUser(updated: unknown) {
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
  }

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
      applyUpdatedUser(updated)
      // Apply the new personal locale/timezone to date formatting immediately
      // (workspace default stays the fallback).
      setFormatPrefs(
        resolveFormatPrefs(
          { locale: data.locale, timezone: data.timezone },
          (updated as { workspaceDefaults?: WorkspaceDefaults }).workspaceDefaults ?? null,
        ),
      )
      notify.success(t('profile.profileUpdated'))
    } catch {
      profile.setError('root', { message: t('profile.networkError') })
    }
  }

  // Reflect an avatar change into the auth store + form. The upload's confirm
  // step already persisted `avatarUrl` server-side, so this is local-only.
  function applyAvatar(url: string | null) {
    const current = useAuthStore.getState().user
    if (current) {
      setUser({ ...current, avatarUrl: url ?? undefined }, useAuthStore.getState().memberships)
    }
    profile.setValue('avatarUrl', url ?? '', { shouldDirty: false })
  }

  // Remove has no attachment flow — clear the avatar via the existing profile
  // update path, then reflect it locally.
  async function removeAvatar() {
    const {
      data: updated,
      error,
      response,
    } = await apiClient.PATCH('/v1/auth/me', {
      body: { avatarUrl: null },
    })
    if (error) throw new Error(apiErrorMessage(error, response.status))
    applyUpdatedUser(updated)
    profile.setValue('avatarUrl', '', { shouldDirty: false })
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
    <div className="max-w-2xl space-y-6">
      {/* Personal Information + Preferences share one RHF form + Save footer. */}
      <form onSubmit={profile.handleSubmit(onSaveProfile)} className="space-y-6">
        <Card>
          <CardHeader title={t('profile.personalInfo')} />
          <CardBody className="space-y-4">
            <FormField
              label={t('profile.displayNameLabel')}
              error={profile.formState.errors.displayName?.message}
            >
              <Input
                {...profile.register('displayName')}
                placeholder={t('profile.displayNamePlaceholder')}
              />
            </FormField>
            <FormField label={t('profile.avatarLabel')}>
              <AvatarUploader
                name={watchedName || (user?.displayName ?? '')}
                value={watchedAvatar || (user?.avatarUrl ?? null)}
                onUploaded={applyAvatar}
                onRemove={removeAvatar}
              />
            </FormField>
            <FormField
              label={t('profile.phoneLabel')}
              error={profile.formState.errors.phone?.message}
            >
              <Input {...profile.register('phone')} placeholder={t('profile.phonePlaceholder')} />
            </FormField>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('profile.sectionPreferences')} />
          <CardBody className="space-y-4">
            <FormField label={t('profile.localeLabel')}>
              <Controller
                control={profile.control}
                name="locale"
                render={({ field }) => (
                  <SearchableSelect
                    variant="field"
                    value={field.value ?? ''}
                    ariaLabel={t('profile.localeLabel')}
                    options={LOCALES}
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
          </CardBody>
        </Card>

        {profile.formState.errors.root && (
          <p className="text-ui-sm text-destructive">{profile.formState.errors.root.message}</p>
        )}
        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" disabled={profile.formState.isSubmitting}>
            {profile.formState.isSubmitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('saveChanges')}
          </Button>
        </div>
      </form>

      {/* Account — read-only identity + security note + sign-out-all. */}
      <Card>
        <CardHeader title={t('profile.account')} />
        <CardBody className="space-y-4">
          <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2.5 text-ui-md">
            <dt className="text-foreground-subtle">{t('profile.emailLabel')}</dt>
            <dd className="text-foreground">
              <span className="font-medium">{user?.email}</span>
              {user?.emailVerified === false && (
                <span className="ml-2 text-ui-sm font-semibold text-warning">
                  {t('profile.notVerified')}
                </span>
              )}
            </dd>
          </dl>
          <p className="text-ui-sm text-foreground-subtle">{t('profile.passwordSecurityNote')}</p>
          <div className="flex items-center gap-3 pt-1">
            <Button variant="destructive" onClick={() => void handleLogoutAll()}>
              <LogOut size={14} />
              {t('profile.signOutAll')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
