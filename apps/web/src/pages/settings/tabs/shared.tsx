import { forwardRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { BRAND } from '@/shared/config/brand'

// ── Shared bits used by multiple settings tabs ─────────────────────────────────

export function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        className="mb-1.5 block text-[12px] font-medium"
        style={{ color: BRAND.textSecondary }}
      >
        {label}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-[11px]" style={{ color: BRAND.danger }}>
          {error}
        </p>
      )}
    </div>
  )
}

export function Divider() {
  return <hr style={{ borderColor: BRAND.borderSubtle }} />
}

export const PasswordInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { show: boolean; onToggle: () => void }
>(({ show, onToggle, ...props }, ref) => (
  <div className="relative">
    <input
      ref={ref}
      type={show ? 'text' : 'password'}
      className="w-full rounded-md px-3 py-2 pr-9 text-[13px] focus:outline-none"
      style={{ border: `1px solid ${BRAND.border}`, color: BRAND.textPrimary }}
      {...props}
    />
    <button
      type="button"
      onClick={onToggle}
      className="absolute top-1/2 right-2.5 -translate-y-1/2"
      tabIndex={-1}
    >
      {show ? (
        <EyeOff size={14} style={{ color: BRAND.textMuted }} />
      ) : (
        <Eye size={14} style={{ color: BRAND.textMuted }} />
      )}
    </button>
  </div>
))
PasswordInput.displayName = 'PasswordInput'
