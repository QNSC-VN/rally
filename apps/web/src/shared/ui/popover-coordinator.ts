/**
 * Single-open coordinator for the shared cell/field popovers (`SearchableSelect`,
 * `DateField`). Radix closes a popover on a genuine outside click, but two
 * *non-modal* popovers can otherwise be open at once (clicking a second trigger
 * doesn't reliably dismiss the first). This module keeps one module-level
 * "active close" callback: opening any coordinated popover first closes whatever
 * was open, guaranteeing only one is visible without resorting to a modal
 * overlay (which would lock grid scroll / require a double click).
 */
let activeClose: (() => void) | null = null

/** Call when a popover opens — closes the previously-open one, registers this. */
export function registerOpenPopover(close: () => void) {
  if (activeClose && activeClose !== close) activeClose()
  activeClose = close
}

/** Call when a popover closes — clears the registration if it's still the active one. */
export function unregisterOpenPopover(close: () => void) {
  if (activeClose === close) activeClose = null
}
