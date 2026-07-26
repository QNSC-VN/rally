import { useMutation } from '@tanstack/react-query'

import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'

export type AvatarContentType = 'image/png' | 'image/jpeg' | 'image/webp'

export interface AvatarPresign {
  uploadUrl: string
  publicUrl: string
}

/**
 * Presign a direct-to-bucket PUT for the current user's avatar. The API returns
 * the short-lived upload URL plus the CDN URL the object will resolve at, which
 * the caller then persists via `PATCH /auth/me { avatarUrl }`.
 */
export function useAvatarPresign() {
  return useMutation({
    mutationFn: async (input: {
      contentType: AvatarContentType
      contentLength: number
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
 * PUT the raw bytes straight to the public-assets bucket via the presigned URL.
 * This targets a DIFFERENT origin (Cloudflare R2 / S3), so it deliberately does
 * NOT carry our CSRF token — sending it would leak the token cross-origin and be
 * rejected by the bucket's CORS. The presigned URL is the only authorization the
 * PUT needs (the same exemption the attachment upload relies on).
 */
export async function uploadAvatarToBucket(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!res.ok) throw new Error(`Avatar upload failed (${res.status})`)
}
