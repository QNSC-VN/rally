import { Check, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { useSaveState } from '@/shared/lib/hooks/use-save-state'

type SaveStatus = ReturnType<typeof useSaveState>['status']

interface SaveIndicatorProps {
  status: SaveStatus
  errorMsg?: string | null
  className?: string
}

/**
 * SaveIndicator — shows inline save feedback next to auto-save fields.
 * Renders nothing when status is 'idle'.
 */
export function SaveIndicator({ status, errorMsg, className }: SaveIndicatorProps) {
  if (status === 'idle') return null

  return (
    <span
      className={cn('flex items-center gap-1 text-ui-xs font-medium', className)}
      aria-live="polite"
    >
      {status === 'saving' && (
        <>
          <Loader2 size={10} className="animate-spin text-primary" />
          <span className="text-muted-foreground">Saving…</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Check size={10} className="text-emerald-500" />
          <span className="text-emerald-600">Saved</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle size={10} className="text-destructive" />
          <span className="text-destructive">{errorMsg ?? 'Save failed'}</span>
        </>
      )}
    </span>
  )
}
