import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Trash2, Upload } from 'lucide-react'

import { notify } from '@/shared/lib/toast'
import { Button } from '@/shared/ui/button'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import {
  useAvatarPresign,
  uploadAvatarToBucket,
  type AvatarContentType,
} from '../model/avatar-upload'

const ACCEPT = 'image/png,image/jpeg,image/webp'
const ALLOWED_TYPES: readonly AvatarContentType[] = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 2 * 1024 * 1024

/**
 * Profile photo control — shows the current avatar and uploads a replacement
 * directly to the public-assets bucket (presign → PUT → persist `avatarUrl`).
 * `onCommit` persists the resolved CDN URL (or null to clear) via the existing
 * profile update, so the change is saved immediately (optimistic).
 */
export function AvatarUploader({
  name,
  value,
  onCommit,
}: {
  name: string
  value?: string | null
  onCommit: (url: string | null) => Promise<void>
}) {
  const { t } = useTranslation('settings')
  const inputRef = useRef<HTMLInputElement>(null)
  const presign = useAvatarPresign()
  const [busy, setBusy] = useState(false)

  async function handleFile(file: File) {
    if (!ALLOWED_TYPES.includes(file.type as AvatarContentType)) {
      notify.error(t('profile.avatarTypeError'))
      return
    }
    if (file.size > MAX_BYTES) {
      notify.error(t('profile.avatarSizeError'))
      return
    }
    setBusy(true)
    try {
      const { uploadUrl, publicUrl } = await presign.mutateAsync({
        contentType: file.type as AvatarContentType,
        contentLength: file.size,
      })
      await uploadAvatarToBucket(uploadUrl, file)
      await onCommit(publicUrl)
      notify.success(t('profile.avatarUpdated'))
    } catch (err) {
      notify.fromError(err, t('profile.avatarUploadError'))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    try {
      await onCommit(null)
      notify.success(t('profile.avatarRemoved'))
    } catch (err) {
      notify.fromError(err, t('profile.avatarUploadError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <OwnerAvatar name={name || '?'} avatarUrl={value ?? undefined} size={64} />
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {t('profile.avatarChange')}
          </Button>
          {value && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void handleRemove()}
            >
              <Trash2 size={14} />
              {t('profile.avatarRemove')}
            </Button>
          )}
        </div>
        <p className="text-ui-xs text-foreground-subtle">{t('profile.avatarHint')}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
