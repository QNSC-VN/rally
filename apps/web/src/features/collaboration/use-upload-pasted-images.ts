/**
 * Uploads any pasted-image previews still living in a rich-text field's HTML
 * as blob: URLs, rewriting them to the durable, cookie-authenticated
 * `/attachments/{id}/content` route before the field is persisted.
 *
 * RichTextEditor inserts a pasted image immediately as a local
 * `URL.createObjectURL(file)` preview — no network call. The actual upload
 * only happens here, from the owning page's Save step, via the same
 * presign→PUT→confirm pipeline attachments already use (useUploadAttachment).
 */
import { useCallback } from 'react'
import { useUploadAttachment } from './api'

const BLOB_IMG_RE = /<img\b[^>]*\bsrc="(blob:[^"]+)"[^>]*>/g

/** True when the HTML contains at least one blob: image that still needs uploading. */
export function hasPendingImages(html: string | null | undefined): boolean {
  return !!html && /<img\b[^>]*\bsrc="blob:/.test(html)
}

export function useUploadPastedImages(workItemId: string | undefined) {
  const uploadMutation = useUploadAttachment(workItemId)

  /**
   * Replaces every `src="blob:..."` in `html` with the uploaded attachment's
   * durable content URL. A blob URL that fails to upload is left as-is rather
   * than silently dropping the image — the field save then surfaces the
   * error instead of quietly losing the picture.
   */
  const uploadAndRewrite = useCallback(
    async (html: string): Promise<string> => {
      if (!workItemId || !hasPendingImages(html)) return html

      const blobUrls = [...html.matchAll(BLOB_IMG_RE)].map((m) => m[1])
      const uniqueUrls = [...new Set(blobUrls)]

      const replacements = new Map<string, string>()
      for (const blobUrl of uniqueUrls) {
        const res = await fetch(blobUrl)
        const blob = await res.blob()
        const file = new File([blob], `pasted-image.${blob.type.split('/')[1] || 'png'}`, {
          type: blob.type,
        })
        const attachment = await uploadMutation.mutateAsync(file)
        replacements.set(
          blobUrl,
          `/v1/work-items/${workItemId}/attachments/${attachment.id}/content`,
        )
        URL.revokeObjectURL(blobUrl)
      }

      let rewritten = html
      for (const [blobUrl, contentUrl] of replacements) {
        rewritten = rewritten.split(blobUrl).join(contentUrl)
      }
      return rewritten
    },
    [workItemId, uploadMutation],
  )

  return { uploadAndRewrite, isUploading: uploadMutation.isPending }
}
