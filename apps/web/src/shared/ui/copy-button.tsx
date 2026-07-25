import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { IconButton } from '@/shared/ui/icon-button'

interface CopyButtonProps {
  /** Text written to the clipboard on click. */
  value: string
  /** Accessible label (icon-only button). */
  label: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * CopyButton — copy-to-clipboard icon action. Shows a transient check for ~1.5s
 * after a successful copy. Built on {@link IconButton} so it matches every other
 * icon action (focus ring, hover, disabled) app-wide.
 */
export function CopyButton({ value, label, size = 'sm', className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable (insecure context) — no-op */
    }
  }

  return (
    <IconButton
      type="button"
      size={size}
      aria-label={label}
      title={label}
      className={className}
      onClick={() => void copy()}
    >
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
    </IconButton>
  )
}
