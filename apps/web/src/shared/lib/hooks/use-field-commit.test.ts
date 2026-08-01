import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFieldCommit } from './use-field-commit'
import { notify } from '@/shared/lib/toast'

vi.mock('@/shared/lib/toast', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

/**
 * The hook holds no state, so it is called directly rather than through a renderer.
 *
 * The cases that matter are all about what reaches the API: a blank field must send
 * `null` and not 0, and an illegal value must never be sent at all. Both are the kind of
 * bug that shows up as a 500 or a silently wrong percentage rather than a visible break.
 */
// Named `useSetup` so the rules-of-hooks lint sees a hook calling a hook. The hook holds
// no state and touches no React API, so no renderer is needed.
function useSetup() {
  const mutate = vi.fn()
  const { save, saveNumber } = useFieldCommit<{ patch: { n: number | null } }>({ mutate })
  return { mutate, save, saveNumber }
}

const build = (n: number | null) => ({ patch: { n } })

beforeEach(() => vi.clearAllMocks())

describe('save', () => {
  it('toasts the success message when the mutation resolves', () => {
    const { mutate, save } = useSetup()
    save({ patch: { n: 1 } }, 'Saved')
    const [, options] = mutate.mock.calls[0]
    options.onSuccess()
    expect(notify.success).toHaveBeenCalledWith('Saved')
  })

  it("surfaces the mutation's own error message, not a generic one", () => {
    const { mutate, save } = useSetup()
    save({ patch: { n: 1 } }, 'Saved')
    const [, options] = mutate.mock.calls[0]
    options.onError(new Error('Refined Estimate must be greater than 0'))
    expect(notify.error).toHaveBeenCalledWith('Refined Estimate must be greater than 0')
  })
})

describe('saveNumber', () => {
  it('sends null for a blank field — clearing is not writing 0', () => {
    const { mutate, saveNumber } = useSetup()
    saveNumber('   ', build, 'Saved', 'Bad')
    expect(mutate).toHaveBeenCalledWith({ patch: { n: null } }, expect.anything())
  })

  it('parses a decimal, since points and hours are not integers', () => {
    const { mutate, saveNumber } = useSetup()
    saveNumber('2.5', build, 'Saved', 'Bad')
    expect(mutate).toHaveBeenCalledWith({ patch: { n: 2.5 } }, expect.anything())
  })

  it('refuses a non-number instead of sending NaN', () => {
    const { mutate, saveNumber } = useSetup()
    saveNumber('eight', build, 'Saved', 'Bad')
    expect(mutate).not.toHaveBeenCalled()
    expect(notify.error).toHaveBeenCalledWith('Bad')
  })

  it('refuses a negative number', () => {
    const { mutate, saveNumber } = useSetup()
    saveNumber('-1', build, 'Saved', 'Bad')
    expect(mutate).not.toHaveBeenCalled()
    expect(notify.error).toHaveBeenCalledWith('Bad')
  })

  it('accepts 0 — an hour count of zero is a real value, unlike a blank', () => {
    const { mutate, saveNumber } = useSetup()
    saveNumber('0', build, 'Saved', 'Bad')
    expect(mutate).toHaveBeenCalledWith({ patch: { n: 0 } }, expect.anything())
  })

  it('refuses Infinity, which Number() accepts', () => {
    const { mutate, saveNumber } = useSetup()
    saveNumber('Infinity', build, 'Saved', 'Bad')
    expect(mutate).not.toHaveBeenCalled()
    expect(notify.error).toHaveBeenCalledWith('Bad')
  })
})
