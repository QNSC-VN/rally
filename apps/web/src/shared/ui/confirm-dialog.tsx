/**
 * ConfirmDialog — the single source of truth for confirmation modals.
 *
 * Use for any confirm/cancel decision, destructive or not, so every dialog
 * shares the same shell, focus trap, and Button styling. Two modes:
 *
 *  1. Simple confirm — just a message + Confirm/Cancel buttons.
 *  2. Typed confirmation — pass `confirmText` and the Confirm button stays
 *     disabled until the user types that exact string (case-sensitive). This
 *     guards irreversible operations (deleting a status/label, removing access)
 *     against accidental clicks. Supplying `confirmText` implies `destructive`.
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
 *
 *   <ConfirmDialog
 *     open={!!target}
 *     title="Delete label"
 *     message="This permanently removes the label from every work item."
 *     confirmText={target?.name ?? ''}
 *     confirmLabel="Delete label"
 *     pending={remove.isPending}
 *     onConfirm={() => remove.mutate(target.id)}
 *     onCancel={() => setTarget(null)}
 *   />
 */
import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { BRAND } from '@/shared/config/brand'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm button as a destructive (red) action. Implied by `confirmText`. */
  destructive?: boolean
  /** Disable the buttons while the action is in flight. */
  pending?: boolean
  /**
   * When provided, the user must type this exact string to enable the confirm
   * button. Presence of this prop switches the dialog into typed-confirmation
   * mode and implies a destructive action.
   */
  confirmText?: string
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
  confirmText,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const typedMode = confirmText !== undefined
  const isDestructive = destructive || typedMode

  const [value, setValue] = useState('')
  const matches = !typedMode || value === confirmText

  function handleCancel() {
    setValue('')
    onCancel()
  }

  return (
    <AppModal open={open} onClose={handleCancel} title={title} width={typedMode ? 440 : 420}>
      <ModalBody className={typedMode ? 'space-y-4' : undefined}>
        {message && (
          <p className="text-[13px] leading-relaxed" style={{ color: BRAND.textSecondary }}>
            {message}
          </p>
        )}
        {typedMode && (
          <>
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
              disabled={pending}
              className="w-full rounded-md px-3 py-2 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${BRAND.borderInput}`, color: BRAND.textPrimary }}
              placeholder={confirmText}
            />
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="outline" onClick={handleCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={isDestructive ? 'destructive' : 'default'}
          onClick={onConfirm}
          disabled={pending || !matches}
        >
          {pending && <Loader2 size={12} className="animate-spin" />}
          {confirmLabel}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
