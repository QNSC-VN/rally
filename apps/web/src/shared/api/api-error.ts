/**
 * Extracts a human-readable message from an openapi-fetch error body.
 * The BE wraps all errors as: { error: { code, message, ... } }
 *
 * Single source of truth — import this in every feature API module instead
 * of duplicating the extraction logic.
 */
export function apiErrorMessage(error: unknown, status?: number): string {
  let message: string | undefined
  let correlationId: string | undefined
  if (error && typeof error === 'object') {
    // BE error envelope: { error: { code, message, correlationId, ... } }
    const nested = (error as { error?: { message?: string; correlationId?: string } }).error
    if (nested) {
      if (nested.message) message = nested.message
      if (nested.correlationId) correlationId = nested.correlationId
    }
    // Fallback: flat { message } shape
    if (!message) {
      const msg = (error as { message?: string }).message
      if (msg && typeof msg === 'string') message = msg
    }
  }
  const base = message ?? `Request failed (${status})`
  // Surface the server trace id for unexpected / server-side failures so support
  // can grep logs by reference. 4xx messages are self-explanatory and omit it.
  if (correlationId && (status === undefined || status >= 500)) {
    return `${base} (ref: ${correlationId})`
  }
  return base
}
