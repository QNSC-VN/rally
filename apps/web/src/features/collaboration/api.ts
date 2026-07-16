/**
 * Collaboration feature — attachment and comment API hooks.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/http-client'
import { apiErrorMessage } from '@/shared/api/api-error'
import type { components } from '@/shared/api/generated/api'

// ── Types ─────────────────────────────────────────────────────────────────────
export type Attachment = components['schemas']['AttachmentResponseDto'] & {
  /** Injected by the upload endpoint — path to download the file */
  downloadPath?: string
}

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

export function useUploadAttachment(workItemId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File): Promise<Attachment> => {
      if (!workItemId) throw new Error('workItemId required')
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/v1/work-items/${workItemId}/attachments/upload`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      })
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(text)
      }
      return (await res.json()) as Attachment
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: attachmentKeys.list(workItemId ?? '') })
    },
  })
}

export function useDeleteAttachment(workItemId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (attachmentId: string) => {
      if (!workItemId) throw new Error('workItemId required')
      const { error, response } = await apiClient.DELETE('/v1/work-items/{id}/attachments/{aid}', {
        params: { path: { id: workItemId, aid: attachmentId } },
      })
      if (error) throw new Error(apiErrorMessage(error, response.status))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: attachmentKeys.list(workItemId ?? '') })
    },
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
  const qc = useQueryClient()
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
    onSuccess: () => {
      if (workItemId) void qc.invalidateQueries({ queryKey: commentKeys.list(workItemId) })
    },
  })
}

export function useUpdateComment(workItemId: string | undefined) {
  const qc = useQueryClient()
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
    onSuccess: () => {
      if (workItemId) void qc.invalidateQueries({ queryKey: commentKeys.list(workItemId) })
    },
  })
}

export function useDeleteComment(workItemId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (commentId: string): Promise<void> => {
      if (!workItemId) throw new Error('workItemId required')
      const res = await fetch(`/v1/work-items/${workItemId}/comments/${commentId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`Failed to delete comment (${res.status})`)
    },
    onSuccess: () => {
      if (workItemId) void qc.invalidateQueries({ queryKey: commentKeys.list(workItemId) })
    },
  })
}
