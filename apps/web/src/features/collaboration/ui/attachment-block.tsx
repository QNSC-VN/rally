/**
 * AttachmentBlock — drag-and-drop / click-to-upload file list component.
 *
 * Features:
 * - Drag & drop zone with visual highlight
 * - Click-to-browse file picker (any file type, max 10 MB)
 * - File list: icon, name, size, date, delete button
 * - Download link via /v1/work-items/{id}/attachments/{id}/download
 * - Read-only mode hides upload zone and delete buttons
 * - Upload progress optimistic UI (spinner on uploading row)
 */
import { BRAND } from '@/shared/config/brand'
import { useRef, useState, useCallback } from 'react'
import { FileText, Paperclip, Trash2, Upload, X } from 'lucide-react'
import {
  useAttachments,
  useUploadAttachment,
  useDeleteAttachment,
} from '@/features/collaboration/api'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

interface AttachmentBlockProps {
  workItemId: string | undefined
  readOnly?: boolean
}

export function AttachmentBlock({ workItemId, readOnly = false }: AttachmentBlockProps) {
  const { data: attachments = [], isLoading } = useAttachments(workItemId)
  const uploadMutation = useUploadAttachment(workItemId)
  const deleteMutation = useDeleteAttachment(workItemId)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [sizeError, setSizeError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || readOnly) return
      setSizeError(null)
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
          setSizeError(`"${file.name}" exceeds the 10 MB limit.`)
          continue
        }
        await uploadMutation.mutateAsync(file).catch(() => null)
      }
    },
    [readOnly, uploadMutation],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      void handleFiles(e.dataTransfer.files)
    },
    [handleFiles],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id)
      await deleteMutation.mutateAsync(id).catch(() => null)
      setDeletingId(null)
    },
    [deleteMutation],
  )

  const isUploading = uploadMutation.isPending

  return (
    <section
      className="overflow-hidden rounded bg-white"
      style={{ border: `1px solid ${BRAND.border}` }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2 text-[11px] font-semibold select-none"
        style={{
          color: '#475569',
          backgroundColor: BRAND.surfaceHover,
          borderBottom: `1px solid ${BRAND.border}`,
        }}
      >
        <Paperclip size={12} />
        <span>Attachments</span>
        {attachments.length > 0 && (
          <span
            className="ml-1 rounded-full px-1.5 py-px text-[10px] font-bold"
            style={{ backgroundColor: BRAND.avatarBg, color: '#475569' }}
          >
            {attachments.length}
          </span>
        )}
      </div>

      {/* File list */}
      <div className="divide-y" style={{ borderColor: BRAND.primaryLighter }}>
        {isLoading && (
          <div className="px-4 py-3 text-[12px]" style={{ color: '#94a3b8' }}>
            Loading…
          </div>
        )}
        {!isLoading && attachments.length === 0 && (
          <div className="px-4 py-3 text-[12px]" style={{ color: '#94a3b8' }}>
            No attachments.
          </div>
        )}
        {attachments.map((a) => {
          const isDeleting = deletingId === a.id
          const downloadUrl =
            a.downloadPath ?? `/v1/work-items/${a.workItemId}/attachments/${a.id}/download`
          return (
            <div
              key={a.id}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50"
              style={{ opacity: isDeleting ? 0.5 : 1 }}
            >
              <FileText size={15} style={{ color: '#64748b', flexShrink: 0 }} />
              <div className="min-w-0 flex-1">
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-[12px] font-medium hover:underline"
                  style={{ color: BRAND.primaryLight }}
                >
                  {a.filename}
                </a>
                <span className="text-[10px]" style={{ color: '#94a3b8' }}>
                  {formatBytes(a.sizeBytes)} · {formatDate(a.createdAt)}
                </span>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Delete ${a.filename}`}
                  onClick={() => void handleDelete(a.id)}
                  disabled={isDeleting}
                  className="rounded p-1 transition-colors hover:bg-red-50"
                  style={{ color: '#94a3b8' }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.color = '#ef4444')
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.color = '#94a3b8')
                  }
                >
                  {isDeleting ? (
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Trash2 size={13} />
                  )}
                </button>
              )}
            </div>
          )
        })}

        {/* Uploading optimistic row */}
        {isUploading && (
          <div className="flex items-center gap-3 px-4 py-2.5">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
            <span className="text-[12px]" style={{ color: '#64748b' }}>
              Uploading…
            </span>
          </div>
        )}
      </div>

      {/* Drop zone */}
      {!readOnly && (
        <div
          className="m-3 rounded-lg transition-all"
          style={{
            border: `2px dashed ${dragging ? BRAND.primaryLight : '#d1d5db'}`,
            backgroundColor: dragging ? BRAND.primaryLighter : BRAND.surfaceHover,
            padding: '16px 12px',
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
            aria-label="Upload file"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-1.5"
          >
            <Upload size={18} style={{ color: dragging ? BRAND.primaryLight : '#94a3b8' }} />
            <span
              className="text-[11px]"
              style={{ color: dragging ? BRAND.primaryLight : '#6b7280' }}
            >
              {dragging ? 'Drop to upload' : 'Drag & drop or click to upload'}
            </span>
            <span className="text-[10px]" style={{ color: '#9ca3af' }}>
              Any file · max 10 MB
            </span>
          </button>
        </div>
      )}

      {/* Error message */}
      {sizeError && (
        <div
          className="mx-3 mb-3 flex items-center justify-between gap-2 rounded px-3 py-2 text-[11px]"
          style={{
            backgroundColor: BRAND.dangerBg,
            border: '1px solid #fca5a5',
            color: BRAND.danger,
          }}
        >
          <span>{sizeError}</span>
          <button type="button" onClick={() => setSizeError(null)} aria-label="Dismiss error">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Upload mutation error */}
      {uploadMutation.isError && (
        <div
          className="mx-3 mb-3 flex items-center justify-between gap-2 rounded px-3 py-2 text-[11px]"
          style={{
            backgroundColor: BRAND.dangerBg,
            border: '1px solid #fca5a5',
            color: BRAND.danger,
          }}
        >
          <span>Upload failed: {(uploadMutation.error as Error)?.message ?? 'Unknown error'}</span>
          <button type="button" onClick={() => uploadMutation.reset()} aria-label="Dismiss error">
            <X size={12} />
          </button>
        </div>
      )}
    </section>
  )
}
