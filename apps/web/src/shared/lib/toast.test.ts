import { describe, expect, it, vi, beforeEach } from 'vitest'

const success = vi.fn()
const error = vi.fn()
const info = vi.fn()
const warning = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => success(...a),
    error: (...a: unknown[]) => error(...a),
    info: (...a: unknown[]) => info(...a),
    warning: (...a: unknown[]) => warning(...a),
  },
}))

import { notify, errorMessage } from './toast'

beforeEach(() => {
  success.mockClear()
  error.mockClear()
  info.mockClear()
  warning.mockClear()
})

describe('errorMessage', () => {
  it('unwraps an Error to its message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })
  it('passes a raw string through', () => {
    expect(errorMessage('nope')).toBe('nope')
  })
  it('falls back for unknown shapes', () => {
    expect(errorMessage({ weird: true }, 'fallback')).toBe('fallback')
    expect(errorMessage(null)).toBe('Something went wrong')
  })
})

describe('notify', () => {
  it('forwards message + description to the right sonner method', () => {
    notify.success('Saved', 'All good')
    expect(success).toHaveBeenCalledWith('Saved', { description: 'All good' })
    notify.error('Nope')
    expect(error).toHaveBeenCalledWith('Nope', { description: undefined })
    notify.info('FYI')
    expect(info).toHaveBeenCalledWith('FYI', { description: undefined })
    notify.warning('Careful')
    expect(warning).toHaveBeenCalledWith('Careful', { description: undefined })
  })

  it('fromError shows the unwrapped error message', () => {
    notify.fromError(new Error('kaboom'))
    expect(error).toHaveBeenCalledWith('kaboom')
  })

  it('fromError uses the fallback for non-Error values', () => {
    notify.fromError(undefined, 'Could not save')
    expect(error).toHaveBeenCalledWith('Could not save')
  })
})
