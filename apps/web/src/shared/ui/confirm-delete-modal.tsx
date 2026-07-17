/**
 * ConfirmDeleteModal — reusable typed-confirmation dialog for destructive actions.
 *
 * The confirm button stays disabled until the user types the exact `confirmText`
 * (case-sensitive). This guards irreversible operations (deleting a status, label,
 * removing workspace access, etc.) against accidental clicks.
 *
 * Usage:
 *   <ConfirmDeleteModal
 *     open={!!target}
 *     title="Delete label"
 *     confirmText={target.name}
 *     description="This permanently removes the label from every work item."
 *     confirmLabel="Delete label"
 *     isPending={remove.isPending}
 *     onConfirm={() => remove.mutate(target.id)}
 *     onClose={() => setTarget(null)}
 *   />
 */
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { BRAND } from '@/shared/config/brand'

interface ConfirmDeleteModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  /** Header title, e.g. "Delete status". */
  title: string
  /** Exact string the user must type to enable the destructive button. */
  confirmText: string
  /** Explanatory copy about the consequence of the action. */
  description?: string
  /** Destructive button label. Default: "Delete". */
  confirmLabel?: string
  /** Disables inputs + shows a spinner while the action runs. */
  isPending?: boolean
}

export function ConfirmDeleteModal({
  open,
  onClose,
  onConfirm,
  title,
  confirmText,
  description,
  confirmLabel = 'Delete',
  isPending = false,
}: ConfirmDeleteModalProps) {
  const [value, setValue] = useState('')
  const matches = value === confirmText

  function handleClose() {
    setValue('')
    onClose()
  }

  return (
    <AppModal open={open} onClose={handleClose} title={title} width={440}>
      <ModalBody className="space-y-4">
        {description && (
          <p className="text-[13px]" style={{ color: BRAND.textSecondary }}>
            {description}
          </p>
        )}
        <p className="text-[13px]" style={{ color: BRAND.textSecondary }}>
          Type{' '}
          <span className="font-semibold" style={{ color: BRAND.textPrimary }}>
            {confirmText}
          </span>{' '}
          to confirm.
        </p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          disabled={isPending}
          className="w-full rounded-md px-3 py-2 text-[13px] focus:outline-none"
          style={{ border: `1px solid ${BRAND.borderInput}`, color: BRAND.textPrimary }}
          placeholder={confirmText}
        />
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          onClick={handleClose}
          disabled={isPending}
          className="rounded-md px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
          style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textSecondary }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!matches || isPending}
          className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: BRAND.danger }}
        >
          {isPending && <Loader2 size={12} className="animate-spin" />}
          {confirmLabel}
        </button>
      </ModalFooter>
    </AppModal>
  )
}
