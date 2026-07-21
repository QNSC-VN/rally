import { useCallback, useState } from 'react'

/**
 * useDisclosure — open/close state for modals, popovers, menus, panels.
 *
 * Replaces the ~13 hand-rolled `const [open, setOpen] = useState(false)` toggles
 * scattered across pages. The generic payload lets a single hook drive an
 * "edit X" modal — `open(item)` stashes the row so the modal can read it, and
 * `data` is cleared on close.
 *
 * Usage:
 *   const modal = useDisclosure<Release>()
 *   <Button onClick={() => modal.open(release)}>Edit</Button>
 *   <AppModal open={modal.isOpen} onClose={modal.close}>{modal.data?.name}</AppModal>
 */
export function useDisclosure<T = void>(initialOpen = false) {
  const [isOpen, setIsOpen] = useState(initialOpen)
  const [data, setData] = useState<T | undefined>(undefined)

  const open = useCallback((payload?: T) => {
    setData(payload)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    setData(undefined)
  }, [])

  const toggle = useCallback(() => setIsOpen((v) => !v), [])

  return { isOpen, data, open, close, toggle, setIsOpen }
}
