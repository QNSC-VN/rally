import { Lock } from 'lucide-react'
import { BRAND } from '@/shared/config/brand'

// ── Coming soon tab ───────────────────────────────────────────────────────────

export function ComingSoonTab({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20">
      <Lock size={22} style={{ color: BRAND.border }} />
      <p className="text-[13px] font-medium" style={{ color: BRAND.textSecondary }}>
        {label}
      </p>
      <p className="text-[12px]" style={{ color: BRAND.textMuted }}>
        Available in a future release.
      </p>
    </div>
  )
}
