/**
 * Collaboration feature — attachment and comment API hooks.
 */
import { useQuery, useMutation } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'

// ── Types ─────────────────────────────────────────────────────────────────────
export type Attachment = components['schemas']['AttachmentResponseDto']

// ── Query keys ────────────────────────────────────────────────────────────────
const attachmentKeys = {
  list: (workItemId: string) => ['attachments', workItemId] as const,
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useAttachments(workItemId: string | undefined) {
  return useQuery({
    queryKey: attachmentKeys.list(workItemId ?? ''),
    queryFn: async () => {
      if (!workItemId) return []
      const { data, error, response } = await apiClient.GET('/v1/work-items/{id}/attachments', {
        params: { path: { id: workItemId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
      return (data as unknown as Attachment[]) ?? []
    },
    enabled: !!workItemId,
    staleTime: 15_000,
  })
}

/**
 * Base64 SHA-256 of a file, computed in the browser.
 *
 * The API binds this into the presigned PUT signature, so the bucket itself
 * rejects a body that does not match it. Requires a secure context
 * (crypto.subtle is undefined over plain HTTP on a non-localhost origin).
 */
async function sha256Base64(file: File): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error('Secure context required to upload files (crypto.subtle unavailable)')
  }
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Three-phase upload: presign → PUT direct to the bucket → confirm.
 *
 * Bytes never pass through the API, which is what makes this scale — the API
 * only ever handles the small JSON legs. The previous implementation POSTed
 * multipart to `/attachments/upload`, a route that has never existed on the
 * backend, so uploading always 404'd.
 */
export function useUploadAttachment(workItemId: string | undefined) {
  return useMutation({
    mutationFn: async (file: File): Promise<Attachment> => {
      if (!workItemId) throw new Error('workItemId required')

      const checksumSha256 = await sha256Base64(file)

      // 1. Reserve the file row and get a signed URL.
      const presignRes = await fetch(`/v1/work-items/${workItemId}/attachments/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          checksumSha256,
        }),
      })
      if (!presignRes.ok) {
        throw new Error(await presignRes.text().catch(() => presignRes.statusText))
      }
      const { attachmentId, uploadUrl, requiredHeaders } = (await presignRes.json()) as {
        attachmentId: string
        uploadUrl: string
        requiredHeaders: Record<string, string>
      }

      // 2. PUT the bytes straight to the bucket. `requiredHeaders` are part of
      //    the signature — sending anything else fails with SignatureDoesNotMatch.
      //    Deliberately omits credentials: this origin is the bucket, not the API,
      //    and the presigned URL is the only authorization it needs.
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: requiredHeaders,
        body: file,
      })
      if (!putRes.ok) {
        throw new Error(`Upload failed (${putRes.status})`)
      }

      // 3. Confirm — the API verifies size + checksum against the bucket and
      //    only then links the file to the work item and makes it visible.
      const confirmRes = await fetch(
        `/v1/work-items/${workItemId}/attachments/${attachmentId}/confirm`,
        { method: 'POST', credentials: 'include' },
      )
      if (!confirmRes.ok) {
        throw new Error(await confirmRes.text().catch(() => confirmRes.statusText))
      }
      return (await confirmRes.json()) as Attachment
    },
    meta: workItemId ? { invalidateKeys: [attachmentKeys.list(workItemId)] } : undefined,
  })
}

export function useDeleteAttachment(workItemId: string | undefined) {
  return useMutation({
    mutationFn: async (attachmentId: string) => {
      if (!workItemId) throw new Error('workItemId required')
      const { error, response } = await apiClient.DELETE('/v1/work-items/{id}/attachments/{aid}', {
        params: { path: { id: workItemId, aid: attachmentId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    meta: workItemId ? { invalidateKeys: [attachmentKeys.list(workItemId)] } : undefined,
  })
}

// ── Comments (F5) ─────────────────────────────────────────────────────────────
// The comments endpoints exist on the API; called via raw fetch (same pattern as
// attachment upload) until the generated OpenAPI client is regenerated.

export interface Comment {
  id: string
  workItemId: string
  authorId: string
  body: string
  parentId: string | null
  isEdited: boolean
  editedAt: string | null
  createdAt: string
  updatedAt: string
}

const commentKeys = {
  list: (workItemId: string) => ['comments', workItemId] as const,
}

export function useComments(workItemId: string | undefined) {
  return useQuery({
    queryKey: commentKeys.list(workItemId ?? ''),
    queryFn: async (): Promise<Comment[]> => {
      if (!workItemId) return []
      const res = await fetch(`/v1/work-items/${workItemId}/comments`, { credentials: 'include' })
      if (!res.ok) throw new Error(`Failed to load comments (${res.status})`)
      return (await res.json()) as Comment[]
    },
    enabled: !!workItemId,
    staleTime: 10_000,
  })
}

export function useCreateComment(workItemId: string | undefined) {
  return useMutation({
    mutationFn: async (input: {
      body: string
      parentId?: string
      mentionedUserIds?: string[]
    }): Promise<Comment> => {
      if (!workItemId) throw new Error('workItemId required')
      const res = await fetch(`/v1/work-items/${workItemId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error(`Failed to add comment (${res.status})`)
      return (await res.json()) as Comment
    },
    meta: workItemId ? { invalidateKeys: [commentKeys.list(workItemId)] } : undefined,
  })
}

export function useUpdateComment(workItemId: string | undefined) {
  return useMutation({
    mutationFn: async (input: { commentId: string; body: string }): Promise<Comment> => {
      if (!workItemId) throw new Error('workItemId required')
      const res = await fetch(`/v1/work-items/${workItemId}/comments/${input.commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ body: input.body }),
      })
      if (!res.ok) throw new Error(`Failed to edit comment (${res.status})`)
      return (await res.json()) as Comment
    },
    meta: workItemId ? { invalidateKeys: [commentKeys.list(workItemId)] } : undefined,
  })
}

export function useDeleteComment(workItemId: string | undefined) {
  return useMutation({
    mutationFn: async (commentId: string): Promise<void> => {
      if (!workItemId) throw new Error('workItemId required')
      const res = await fetch(`/v1/work-items/${workItemId}/comments/${commentId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`Failed to delete comment (${res.status})`)
    },
    meta: workItemId ? { invalidateKeys: [commentKeys.list(workItemId)] } : undefined,
  })
}
