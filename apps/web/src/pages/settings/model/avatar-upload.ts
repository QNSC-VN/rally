import { useMutation } from '@tanstack/react-query'

import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

export type AvatarContentType = 'image/png' | 'image/jpeg' | 'image/webp'

export interface AvatarPresign {
  fileId: string
  uploadUrl: string
  requiredHeaders: Record<string, string>
}

/**
 * base64-encoded SHA-256 of a file. The shared AttachmentsService binds this into
 * the confirm-time integrity check, so every upload surface (including avatars)
 * must declare it at presign time. Requires a secure context (crypto.subtle).
 */
export async function sha256Base64(file: File): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error('Secure context required to upload files (crypto.subtle unavailable)')
  }
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Step 1 — reserve a file row and get a presigned bucket PUT. Mirrors the
 * work-item attachment flow via the shared AttachmentsService + USER_AVATAR_POLICY.
 */
export function useAvatarPresign() {
  return useMutation({
    mutationFn: async (input: {
      contentType: AvatarContentType
      contentLength: number
      checksumSha256: string
    }): Promise<AvatarPresign> => {
      const { data, error, response } = await apiClient.POST('/v1/auth/me/avatar/presign', {
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      if (!data) throw new Error(apiErrorMessage(undefined, response.status))
      return data
    },
  })
}

/**
 * Step 3 — verify the object landed (size + checksum) and persist it as the
 * user's `avatarUrl`. Returns the durable CDN URL now stored on the profile.
 */
export function useAvatarConfirm() {
  return useMutation({
    mutationFn: async (input: { fileId: string }): Promise<{ avatarUrl: string }> => {
      const { data, error, response } = await apiClient.POST('/v1/auth/me/avatar/confirm', {
        body: input,
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      if (!data) throw new Error(apiErrorMessage(undefined, response.status))
      return data
    },
  })
}

/**
 * Step 2 — PUT the raw bytes straight to the public-assets bucket via the
 * presigned URL. Sends exactly the `requiredHeaders` the signature covers.
 *
 * This targets a DIFFERENT origin (Cloudflare R2 / S3), so it deliberately does
 * NOT carry our CSRF token — sending it would leak the token cross-origin and be
 * rejected by the bucket's CORS. The presigned URL is the only authorization the
 * PUT needs (the same exemption the attachment upload relies on).
 */
export async function uploadAvatarToBucket(
  uploadUrl: string,
  requiredHeaders: Record<string, string>,
  file: File,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: requiredHeaders,
    body: file,
  })
  if (!res.ok) throw new Error(`Avatar upload failed (${res.status})`)
}
