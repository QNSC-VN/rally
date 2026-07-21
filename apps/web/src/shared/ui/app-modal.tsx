/**
 * AppModal — Rally's standard modal shell built on Radix Dialog.
 *
 * Benefits over hand-rolled `fixed inset-0` divs:
 *  - Focus trap (Tab stays inside the modal)
 *  - Escape key closes automatically
 *  - Body scroll-lock while open
 *  - Accessible: role=dialog, aria-modal, aria-labelledby via DialogTitle
 *  - Animated open/close (fade + zoom)
 *
 * Exports:
 *   <AppModal>     — modal shell with header (title + subtitle + X button)
 *   <ModalBody>    — scrollable content area with standard padding
 *   <ModalFooter>  — sticky footer row (border-top + surface bg + right-aligned)
 *
 * Usage:
 *   <AppModal open={open} onClose={onClose} title="New Iteration" width={480}>
 *     <ModalBody className="space-y-4">
 *       <FormField label="Name" required>
 *         <Input value={name} onChange={(e) => setName(e.target.value)} />
 *       </FormField>
 *     </ModalBody>
 *     <ModalFooter>
 *       <button onClick={onClose}>Cancel</button>
 *       <button onClick={submit}>Create</button>
 *     </ModalFooter>
 *   </AppModal>
 */
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { cn } from '@/shared/lib/utils'
import { BRAND } from '@/shared/config/brand'

// ── AppModal ──────────────────────────────────────────────────────────────────

interface AppModalProps {
  open: boolean
  onClose: () => void
  /** Shown in the modal header (maps to aria-labelledby via DialogTitle) */
  title: string
  /** Optional secondary line in the header */
  subtitle?: string
  /** Card width in pixels. Default: 480 */
  width?: number
  children: ReactNode
  className?: string
}

export function AppModal({
  open,
  onClose,
  title,
  subtitle,
  width = 480,
  children,
  className,
}: AppModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogPrimitive.Portal>
        {/* ── Backdrop ─────────────────────────────────────────────────────── */}
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.28)' }}
        />

        {/* ── Card ─────────────────────────────────────────────────────────── */}
        <DialogPrimitive.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex flex-col overflow-hidden rounded bg-white shadow-2xl',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'duration-150 outline-none',
            className,
          )}
          style={{ width, border: `1px solid ${BRAND.border}` }}
        >
          {/* ── Header ───────────────────────────────────────────────────── */}
          <div
            className="flex shrink-0 items-center justify-between px-5 py-3.5"
            style={{
              backgroundColor: BRAND.surfaceHover,
              borderBottom: `1px solid ${BRAND.borderSubtle}`,
            }}
          >
            <div>
              <DialogPrimitive.Title
                className="text-ui-lg font-semibold"
                style={{ color: BRAND.textPrimary }}
              >
                {title}
              </DialogPrimitive.Title>
              {subtitle && (
                <DialogPrimitive.Description
                  className="text-ui-sm"
                  style={{ color: BRAND.textMuted }}
                >
                  {subtitle}
                </DialogPrimitive.Description>
              )}
            </div>

            <DialogPrimitive.Close asChild>
              <button
                className="rounded p-0.5 transition-colors hover:bg-border-inner"
                aria-label="Close"
                style={{ color: BRAND.textMuted }}
              >
                <X size={15} />
              </button>
            </DialogPrimitive.Close>
          </div>

          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

// ── ModalBody ─────────────────────────────────────────────────────────────────

interface ModalBodyProps {
  children: ReactNode
  className?: string
}

/** Scrollable content area with standard 20px padding. */
export function ModalBody({ children, className }: ModalBodyProps) {
  return <div className={cn('flex-1 overflow-y-auto p-5', className)}>{children}</div>
}

// ── ModalFooter ───────────────────────────────────────────────────────────────

interface ModalFooterProps {
  children: ReactNode
  className?: string
}

/** Sticky footer row with top border, surface background, and right-aligned content. */
export function ModalFooter({ children, className }: ModalFooterProps) {
  return (
    <div
      className={cn('flex shrink-0 items-center justify-end gap-2 px-5 py-3', className)}
      style={{
        borderTop: `1px solid ${BRAND.borderSubtle}`,
        backgroundColor: BRAND.surfaceHover,
      }}
    >
      {children}
    </div>
  )
}
