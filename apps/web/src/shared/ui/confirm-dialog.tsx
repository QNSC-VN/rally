/**
 * ConfirmDialog — reusable confirmation modal built on AppModal.
 *
 * Use for destructive or irreversible actions (bulk delete, etc.) so every
 * confirmation shares the same shell, focus trap, and button styling.
 *
 * Usage:
 *   <ConfirmDialog
 *     open={open}
 *     title="Delete 3 items?"
 *     message="This permanently removes the selected work items."
 *     confirmLabel="Delete"
 *     destructive
 *     pending={isDeleting}
 *     onConfirm={handleDelete}
 *     onCancel={() => setOpen(false)}
 *   />
 */
import type { ReactNode } from 'react'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { BRAND } from '@/shared/config/brand'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm button as a destructive (red) action. */
  destructive?: boolean
  /** Disable the buttons while the action is in flight. */
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBg = destructive ? BRAND.danger : BRAND.primary
  return (
    <AppModal open={open} onClose={onCancel} title={title} width={420}>
      <ModalBody>
        <p className="text-[13px] leading-relaxed" style={{ color: BRAND.textSecondary }}>
          {message}
        </p>
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded px-3.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-background disabled:opacity-50"
          style={{ color: BRAND.textSecondary }}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="rounded px-3.5 py-1.5 text-[11px] font-semibold text-white transition-opacity disabled:opacity-50"
          style={{ backgroundColor: confirmBg }}
        >
          {pending ? 'Working…' : confirmLabel}
        </button>
      </ModalFooter>
    </AppModal>
  )
}
