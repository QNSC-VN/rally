import { beforeEach, describe, expect, it } from 'vitest'
import { CSRF_HEADER, getCsrfToken, setCsrfToken, withCsrfHeader } from './csrf'

describe('csrf token store', () => {
  beforeEach(() => setCsrfToken(null))

  it('round-trips a token', () => {
    setCsrfToken('tok-1')
    expect(getCsrfToken()).toBe('tok-1')
  })

  it('clears the token on null (session ended)', () => {
    setCsrfToken('tok-1')
    setCsrfToken(null)
    expect(getCsrfToken()).toBeNull()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])('attaches the header on %s', (method) => {
    setCsrfToken('tok-1')
    expect(withCsrfHeader(method)).toEqual({ [CSRF_HEADER]: 'tok-1' })
  })

  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('omits the header on safe method %s', (method) => {
    setCsrfToken('tok-1')
    expect(withCsrfHeader(method)).toEqual({})
  })

  it('preserves existing headers', () => {
    setCsrfToken('tok-1')
    expect(withCsrfHeader('POST', { 'Content-Type': 'application/json' })).toEqual({
      'Content-Type': 'application/json',
      [CSRF_HEADER]: 'tok-1',
    })
  })

  it('omits the header when no token has been issued yet', () => {
    // Pre-bootstrap (or after a dead session) the request goes out without a
    // token and the API answers 403 — better than sending an empty header that
    // reads like a real one.
    expect(withCsrfHeader('POST', { accept: 'application/json' })).toEqual({
      accept: 'application/json',
    })
  })
})
