import { Link } from '@tanstack/react-router'
import { FileQuestion, Home } from 'lucide-react'
import { BRAND } from '@/shared/config/brand'
import { Button } from '@/shared/ui/button'

export function NotFoundPage() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 py-24"
      style={{ backgroundColor: BRAND.pageBg }}
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ backgroundColor: BRAND.primaryLighter }}
      >
        <FileQuestion size={30} style={{ color: BRAND.primaryLight }} />
      </div>
      <div className="text-center">
        <p className="text-[42px] leading-none font-bold" style={{ color: BRAND.textPrimary }}>
          404
        </p>
        <p className="mt-1 text-[14px] font-medium" style={{ color: BRAND.textSecondary }}>
          Page not found
        </p>
        <p className="mt-1 text-[12px]" style={{ color: BRAND.textMuted }}>
          The page you requested doesn't exist or you don't have access.
        </p>
      </div>
      <Button asChild className="mt-2">
        <Link to="/">
          <Home size={14} />
          Back to Home
        </Link>
      </Button>
    </div>
  )
}
