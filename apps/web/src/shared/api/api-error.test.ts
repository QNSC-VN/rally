/**
 * `apiErrorCode` / `ApiError` — the seam that lets a surface branch on a REFUSAL rather than print it.
 *
 * Worth its own spec because the two shapes it accepts are not interchangeable at the call sites that
 * matter. A `queryFn` / `mutationFn` sees openapi-fetch's raw body (`{ error: { code } }`); a
 * mutation's `onError` sees only whatever was thrown, and every hook in this repo throws an `Error`
 * built from the message alone. A helper that handled just the first shape would return `undefined`
 * exactly where the branching happens, and the caller would fall through to its generic state — which
 * is indistinguishable from the bug it replaced.
 */
import { describe, expect, it } from 'vitest'

import { ApiError, apiErrorCode, apiErrorMessage } from './api-error'

describe('apiErrorCode', () => {
  it('reads the code out of the BE error envelope', () => {
    expect(
      apiErrorCode({ error: { code: 'INVITATION_EXPIRED', message: 'Invitation has expired' } }),
    ).toBe('INVITATION_EXPIRED')
  })

  it('reads the code off an ApiError a feature hook already threw', () => {
    const thrown: unknown = new ApiError(
      { error: { code: 'INVITATION_EMAIL_MISMATCH', message: 'x' } },
      422,
    )
    expect(apiErrorCode(thrown)).toBe('INVITATION_EMAIL_MISMATCH')
  })

  it('is undefined for a transport failure, which is NOT a refusal', () => {
    expect(apiErrorCode(new Error('Failed to fetch'))).toBeUndefined()
    expect(apiErrorCode(undefined)).toBeUndefined()
    expect(apiErrorCode('boom')).toBeUndefined()
    // A non-string `code` is not a code. Guarded because the envelope is `unknown` at this boundary.
    expect(apiErrorCode({ error: { code: 500 } })).toBeUndefined()
  })
})

describe('ApiError', () => {
  it('keeps the message identical to apiErrorMessage, so print-only callers are unaffected', () => {
    const body = { error: { code: 'INVITATION_NOT_FOUND', message: 'Invalid or unknown token' } }
    expect(new ApiError(body, 404).message).toBe(apiErrorMessage(body, 404))
  })

  it('is a real Error, so `errorMessage()` and `instanceof` still work on it', () => {
    const err = new ApiError({ error: { code: 'X', message: 'nope' } }, 422)
    expect(err).toBeInstanceOf(Error)
    expect(err.status).toBe(422)
  })
})
