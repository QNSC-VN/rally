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
