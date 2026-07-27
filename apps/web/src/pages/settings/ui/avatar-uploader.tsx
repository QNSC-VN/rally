import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Trash2, Upload } from 'lucide-react'

import { notify } from '@/shared/lib/toast'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { OwnerAvatar } from '@/shared/ui/owner-cell'
import {
  useAvatarPresign,
  useAvatarConfirm,
  uploadAvatarToBucket,
  sha256Base64,
  type AvatarContentType,
} from '../model/avatar-upload'

const ACCEPT = 'image/png,image/jpeg,image/webp'
const ALLOWED_TYPES: readonly AvatarContentType[] = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 2 * 1024 * 1024

/**
 * Profile photo control — shows the current avatar and uploads a replacement
 * via the shared attachment mechanics (presign → PUT to bucket → confirm). The
 * confirm step persists `avatarUrl` server-side and returns the durable CDN URL,
 * which `onUploaded` reflects into the auth store + form. `onRemove` clears it.
 */
export function AvatarUploader({
  name,
  value,
  onUploaded,
  onRemove,
}: {
  name: string
  value?: string | null
  onUploaded: (url: string) => void
  onRemove: () => Promise<void>
}) {
  const { t } = useTranslation('settings')
  const inputRef = useRef<HTMLInputElement>(null)
  const presign = useAvatarPresign()
  const confirm = useAvatarConfirm()
  const [busy, setBusy] = useState(false)
  // Open state for the remove-photo confirmation dialog.
  const [confirmRemove, setConfirmRemove] = useState(false)

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
      const checksumSha256 = await sha256Base64(file)
      const { fileId, uploadUrl, requiredHeaders } = await presign.mutateAsync({
        contentType: file.type as AvatarContentType,
        contentLength: file.size,
        checksumSha256,
      })
      await uploadAvatarToBucket(uploadUrl, requiredHeaders, file)
      const { avatarUrl } = await confirm.mutateAsync({ fileId })
      onUploaded(avatarUrl)
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
      await onRemove()
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
              onClick={() => setConfirmRemove(true)}
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

      <ConfirmDialog
        open={confirmRemove}
        title={t('profile.avatarRemoveTitle', 'Remove photo')}
        message={t('profile.avatarRemoveConfirm', 'Remove your profile photo?')}
        confirmLabel={t('profile.avatarRemove')}
        destructive
        pending={busy}
        onConfirm={() => {
          setConfirmRemove(false)
          void handleRemove()
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  )
}
