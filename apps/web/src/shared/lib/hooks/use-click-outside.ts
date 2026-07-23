import { useEffect, useRef } from 'react'

/**
 * useClickOutside — dismiss a hand-rolled popover/dropdown/menu when the user
 * clicks outside it or presses Escape. Attach the returned ref to the element
 * that wraps BOTH the trigger and the floating panel (so clicking the trigger
 * to toggle isn't treated as an "outside" click).
 *
 * Only listens while `active` is true, so a closed menu carries no document
 * listeners. Uses `mousedown` (fires before `click`/focus) and `pointerdown`
 * so it also dismisses on touch, matching Radix's non-modal behaviour.
 *
 *   const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false))
 *   return <div ref={ref}> <button …/> {open && <panel/>} </div>
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  active: boolean,
  onClose: () => void,
) {
  const ref = useRef<T>(null)
  // Keep the latest onClose without re-subscribing the listeners each render.
  // Assigned in an effect (not during render) so it never touches a ref mid-render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!active) return
    function onPointerDown(e: MouseEvent | PointerEvent) {
      const el = ref.current
      if (el && !el.contains(e.target as Node)) onCloseRef.current()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [active])

  return ref
}
