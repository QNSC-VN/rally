import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn (class name merge)', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b')
  })

  it('applies conditional object syntax', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active')
  })

  it('dedupes conflicting tailwind utilities (last wins)', () => {
    // tailwind-merge keeps the later of two conflicting utilities.
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-sm', 'text-lg')).toBe('text-lg')
  })
})
