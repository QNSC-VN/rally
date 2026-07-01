import { Link } from '@tanstack/react-router'
import { ShieldOff } from 'lucide-react'
import { BRAND } from '@/shared/config/brand'

/**
 * 403 Access Denied page (SHELL-FR-014, P0-08).
 * Shown when the user is authenticated but lacks permission for the resource.
 */
export function ForbiddenPage() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 py-24"
      style={{ backgroundColor: BRAND.pageBg }}
      role="main"
      aria-labelledby="forbidden-heading"
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ backgroundColor: '#fef2f2' }}
      >
        <ShieldOff size={30} style={{ color: '#dc2626' }} />
      </div>
      <div className="text-center">
        <p
          id="forbidden-heading"
          className="text-[42px] font-bold leading-none"
          style={{ color: BRAND.textPrimary }}
        >
          403
        </p>
        <p className="mt-1 text-[14px] font-medium" style={{ color: BRAND.textSecondary }}>
          Access denied
        </p>
        <p
          className="mt-2 max-w-xs text-[13px]"
          style={{ color: BRAND.textSecondary, opacity: 0.8 }}
        >
          You don't have permission to view this page. Contact your Workspace Admin if you think
          this is a mistake.
        </p>
      </div>
      <Link
        to="/"
        className="mt-2 flex items-center gap-1.5 rounded px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
        style={{ backgroundColor: BRAND.primary }}
      >
        Back to Home
      </Link>
    </div>
  )
}
