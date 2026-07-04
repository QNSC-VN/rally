import { useState, useCallback, useRef } from 'react'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface UseSaveStateReturn {
  status: SaveStatus
  errorMsg: string | null
  wrap: <T>(fn: () => Promise<T>) => Promise<T | undefined>
  reset: () => void
}

/**
 * useSaveState — finite state machine for auto-save fields.
 *
 * Usage:
 *   const { status, wrap } = useSaveState()
 *   const save = () => wrap(() => updateMutation.mutateAsync(patch))
 *
 * States: idle → saving → saved (auto-resets after 2s) or error
 */
export function useSaveState(resetDelayMs = 2000): UseSaveStateReturn {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setStatus('idle')
    setErrorMsg(null)
  }, [])

  const wrap = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setStatus('saving')
      setErrorMsg(null)
      try {
        const result = await fn()
        setStatus('saved')
        timerRef.current = setTimeout(() => setStatus('idle'), resetDelayMs)
        return result
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Save failed'
        setStatus('error')
        setErrorMsg(msg)
        timerRef.current = setTimeout(reset, 4000)
        return undefined
      }
    },
    [reset, resetDelayMs],
  )

  return { status, errorMsg, wrap, reset }
}
