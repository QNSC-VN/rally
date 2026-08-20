import { useCanGoBack, useRouter, type NavigateOptions } from '@tanstack/react-router'

/**
 * Leave a detail surface the way the reader arrived at it.
 *
 * Every detail page used to hardcode its own list route in `onBack` — `/item/$itemKey` sent the reader
 * to `/backlog` no matter where they came from. Measured in a browser: opening an item from Home >
 * My Work, from Iteration Status and from Quality > Defects all landed on the Backlog, so the back
 * arrow moved the reader to a THIRD place, silently changed which grid and which filters they had, and
 * on Home — a cross-project surface — could hand them a project-scoped page they never chose. The
 * browser's own back button was always correct; the one in the app was not.
 *
 * So this walks the router's history when there is somewhere to walk back to, and falls back to the
 * entity's list otherwise. The fallback is not a formality: `useCanGoBack()` is false on a deep link
 * opened in a fresh tab — a shared URL, a notification click, a bookmark — where there is no earlier
 * entry in THIS app's history, and `history.back()` would either leave the app or do nothing.
 *
 * Give the entity's own list as the fallback, never Home: a reader who deep-linked into a Release
 * wants Releases when they leave it.
 */
export function useDetailBack(fallback: NavigateOptions): () => void {
  const router = useRouter()
  const canGoBack = useCanGoBack()

  return () => {
    if (canGoBack) {
      router.history.back()
      return
    }
    void router.navigate(fallback)
  }
}
