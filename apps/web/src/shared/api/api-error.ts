/**
 * Extracts a human-readable message from an openapi-fetch error body.
 * The BE wraps all errors as: { error: { code, message, ... } }
 *
 * Single source of truth — import this in every feature API module instead
 * of duplicating the extraction logic.
 */
export function apiErrorMessage(error: unknown, status?: number): string {
  if (error && typeof error === 'object') {
    // BE error envelope: { error: { code, message, ... } }
    const nested = (error as { error?: { message?: string } }).error
    if (nested?.message) return nested.message
    // Fallback: flat { message } shape
    const msg = (error as { message?: string }).message
    if (msg && typeof msg === 'string') return msg
  }
  return `Request failed (${status})`
}
